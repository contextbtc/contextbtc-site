import { toast } from 'svelte-sonner';
import {
	cashuWallet,
	INSUFFICIENT_FUNDS_TEXT,
	InsufficientFundsError
} from '$lib/services/cashu-wallet.svelte';

/**
 * Routstr prices a request by its worst case, discounted by `max_tokens`; without
 * it the node reserves the model's full completion budget (often hundreds of sats).
 */
export const ROUTSTR_MAX_TOKENS = 4096;

interface SatsPricing {
	prompt: number;
	completion: number;
	request?: number;
	max_cost?: number;
}

const pricingCache = new Map<string, Promise<Map<string, SatsPricing>>>();

function getPricing(baseURL: string): Promise<Map<string, SatsPricing>> {
	let pricing = pricingCache.get(baseURL);
	if (!pricing) {
		pricing = fetch(`${baseURL}/models`)
			.then((response) => (response.ok ? response.json() : { data: [] }))
			.then(
				(body: { data?: Array<{ id: string; sats_pricing?: SatsPricing }> }) =>
					new Map(
						(body.data ?? [])
							.filter((model) => model.sats_pricing)
							.map((model) => [model.id, model.sats_pricing as SatsPricing])
					)
			);
		// A failed lookup only costs an extra 402 round-trip; retry it next time.
		pricing.catch(() => pricingCache.delete(baseURL));
		pricingCache.set(baseURL, pricing);
	}
	return pricing;
}

const mintsCache = new Map<string, Promise<string[] | undefined>>();

/**
 * The mints a node accepts tokens from, per its `/info` endpoint. `undefined` when
 * the node doesn't say, in which case paying is attempted anyway.
 */
function getAcceptedMints(baseURL: string): Promise<string[] | undefined> {
	let mints = mintsCache.get(baseURL);
	if (!mints) {
		mints = fetch(`${baseURL}/info`)
			.then((response) => (response.ok ? response.json() : {}))
			.then((body: { mints?: unknown }) =>
				Array.isArray(body.mints) && body.mints.length > 0
					? body.mints.filter((mint): mint is string => typeof mint === 'string')
					: undefined
			);
		mints.catch(() => mintsCache.delete(baseURL));
		mintsCache.set(baseURL, mints);
	}
	return mints;
}

/** Mirrors routstr-core's estimate (~3 chars/token over the whole body) with a 10% margin. */
function estimateSats(pricing: SatsPricing | undefined, body: Record<string, unknown>): number {
	if (!pricing) {
		// Unknown model price: start minimal and let the node's 402 name the exact amount.
		return 1;
	}
	const promptTokens = JSON.stringify(body).length / 3;
	const maxTokens = Number(body.max_tokens) || ROUTSTR_MAX_TOKENS;
	const estimate =
		(promptTokens * pricing.prompt + maxTokens * pricing.completion + (pricing.request ?? 0)) * 1.1;
	return Math.max(1, Math.ceil(estimate));
}

async function readRequiredSats(response: Response): Promise<number | null> {
	try {
		const body = await response.clone().json();
		const msat = Number(body?.detail?.amount_required_msat);
		return Number.isFinite(msat) && msat > 0 ? Math.ceil(msat / 1000) : null;
	} catch {
		return null;
	}
}

/**
 * A `fetch` for the OpenAI client that pays each chat completion with an
 * `X-Cashu` token from the local wallet and receives the change the node returns
 * in the `X-Cashu` response header.
 */
export function createRoutstrFetch(
	baseURL: string
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
	return async (input, init) => {
		const url = input instanceof Request ? input.url : String(input);
		const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
		headers.delete('authorization');

		const isCompletion =
			(init?.method ?? 'GET').toUpperCase() === 'POST' &&
			/\/chat\/completions$/.test(new URL(url).pathname);
		if (!isCompletion || typeof init?.body !== 'string') {
			return fetch(input, { ...init, headers });
		}

		const body = JSON.parse(init.body) as Record<string, unknown>;
		body.max_tokens ??= ROUTSTR_MAX_TOKENS;
		const payload = JSON.stringify(body);

		const [pricing, acceptedMints] = await Promise.all([
			getPricing(baseURL)
				.then((models) => models.get(String(body.model)))
				.catch(() => undefined),
			getAcceptedMints(baseURL).catch(() => undefined)
		]);
		let sats = estimateSats(pricing, body);

		for (let attempt = 0; ; attempt += 1) {
			const response = await payAndSend(url, init, headers, payload, sats, acceptedMints);
			const synthetic = response.headers.get('x-should-retry') === 'false';
			if (response.status !== 402 || synthetic || response.headers.has('x-cashu') || attempt > 0) {
				return response;
			}
			// The node rejects underfunded tokens before redeeming them, and says how much it wants.
			const required = await readRequiredSats(response);
			if (!required || required <= sats) {
				return response;
			}
			sats = required;
		}
	};
}

async function payAndSend(
	url: string,
	init: RequestInit | undefined,
	baseHeaders: Headers,
	payload: string,
	sats: number,
	acceptedMints: string[] | undefined
): Promise<Response> {
	let pending;
	try {
		pending = await cashuWallet.createToken(sats, acceptedMints);
	} catch (error) {
		return walletErrorResponse(error);
	}
	const headers = new Headers(baseHeaders);
	headers.set('X-Cashu', pending.token);

	let response: Response;
	try {
		response = await fetch(url, { ...init, headers, body: payload });
	} catch (error) {
		await reclaim(pending.id, pending.amount);
		throw error;
	}

	const change = response.headers.get('x-cashu');
	if (change) {
		// The node took the token and returned the unspent part.
		cashuWallet.settleSend(pending.id);
		try {
			await cashuWallet.receiveToken(change);
		} catch (error) {
			console.error('Failed to receive Routstr change:', error, change);
			toast.error('Could not receive change from Routstr', {
				description: error instanceof Error ? error.message : undefined
			});
		}
	} else if (response.ok) {
		cashuWallet.settleSend(pending.id);
	} else {
		// No refund header on an error: reclaim checks with the mint whether it was redeemed.
		await reclaim(pending.id, pending.amount);
	}

	return response;
}

/**
 * The OpenAI SDK reports errors thrown by `fetch` as a generic, retried "Connection
 * error.", so wallet failures are returned as non-retryable HTTP errors instead.
 * The SDK surfaces them as `<status> <message>`.
 */
function walletErrorResponse(error: unknown): Response {
	const insufficient = error instanceof InsufficientFundsError;
	const message = error instanceof Error ? error.message : 'Cashu wallet error.';
	return new Response(JSON.stringify({ error: { message, type: 'cashu_wallet_error' } }), {
		status: insufficient ? 402 : 424,
		headers: { 'content-type': 'application/json', 'x-should-retry': 'false' }
	});
}

async function reclaim(id: string, amount: number): Promise<void> {
	try {
		await cashuWallet.reclaimSend(id);
	} catch (error) {
		// Stays in pendingSends; the wallet retries on next load and offers "Recover".
		console.warn('Failed to reclaim Cashu token:', error);
		toast.error(`${amount.toLocaleString()} sats are pending recovery`, {
			description: `The payment failed and the token could not be taken back yet (${
				error instanceof Error ? error.message : 'unknown error'
			}). Use "Recover" in the wallet.`
		});
	}
}

/** Matches chat errors caused by an empty or underfunded wallet. */
export function isInsufficientFundsMessage(message: string): boolean {
	return message.includes(INSUFFICIENT_FUNDS_TEXT);
}
