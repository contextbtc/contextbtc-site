import { browser } from '$app/environment';
import {
	CheckStateEnum,
	getEncodedToken,
	getTokenMetadata,
	MeltQuoteState,
	MintQuoteState,
	NetworkError,
	Wallet,
	type MeltQuoteBolt11Response,
	type Proof,
	type ProofLike
} from '@cashu/cashu-ts';

export const CASHU_MINT_URL = normalizeMintUrl(
	import.meta.env.VITE_CASHU_MINT_URL?.trim() || 'https://mint.minibits.cash/Bitcoin'
);

const STORAGE_KEY = 'contextbtc.cashu.wallet';
const TOPUP_PROMPT_SEEN_KEY = 'contextbtc.cashu.topupPromptSeen';
const QUOTE_POLL_INTERVAL_MS = 3_000;

/** Proofs are kept as plain JSON (number amounts) so they survive localStorage round-trips. */
type StoredProof = Omit<Proof, 'amount'> & { amount: number };

export interface PendingQuote {
	mintUrl: string;
	quote: string;
	request: string;
	amount: number;
	/** Unix seconds, or null when the mint sets no expiry. */
	expiry: number | null;
}

/**
 * A token that has left the wallet but whose recipient hasn't redeemed it yet.
 *
 * - `provider`: handed to a provider mid-request. If the request fails or the page
 *   dies, `init()` receives it back so the sats aren't stranded.
 * - `export`: shown to the user to give away. Never reclaimed automatically; it is
 *   dropped once the mint reports it spent, or when the user reclaims it.
 */
export interface PendingSend {
	id: string;
	kind: 'provider' | 'export';
	mintUrl: string;
	token: string;
	/** The proofs inside `token`, so their state can be checked without decoding it. */
	proofs: StoredProof[];
	amount: number;
	createdAt: number;
}

type SendState = 'unspent' | 'spent' | 'pending';

/** What paying a given invoice costs, before the user confirms it. */
export interface WithdrawalQuote {
	id: string;
	mintUrl: string;
	amount: number;
	/** Upper bound on the routing fee; the unused part comes back as change. */
	feeReserve: number;
	total: number;
}

interface WalletState {
	proofsByMint: Record<string, StoredProof[]>;
	pendingQuote: PendingQuote | null;
	pendingSends: PendingSend[];
	/** Bumped on each successful Lightning top-up so UI can react to it. */
	fundedCount: number;
	loaded: boolean;
}

export const INSUFFICIENT_FUNDS_TEXT = 'Not enough sats in your wallet';

export class InsufficientFundsError extends Error {
	constructor(
		public readonly required: number,
		public readonly available: number
	) {
		super(`${INSUFFICIENT_FUNDS_TEXT} (need ~${required}, have ${available}).`);
		this.name = 'InsufficientFundsError';
	}
}

function mintHosts(urls: string[]): string {
	return urls.map((url) => url.replace(/^https?:\/\//, '')).join(', ') || 'none';
}

/** None of the mints a provider accepts holds enough sats in this wallet. */
export class UnacceptedMintError extends Error {
	constructor(
		public readonly acceptedMints: string[],
		public readonly heldMints: string[]
	) {
		super(
			`This provider only accepts ecash from ${mintHosts(acceptedMints)}, but your sats are at ${mintHosts(heldMints)}. No sats were spent.`
		);
		this.name = 'UnacceptedMintError';
	}
}

function normalizeMintUrl(url: string): string {
	return url.trim().replace(/\/+$/, '');
}

function toStored(proofs: Proof[]): StoredProof[] {
	return proofs.map((proof) => ({ ...proof, amount: proof.amount.toNumber() }));
}

function sum(proofs: Array<{ amount: number }>): number {
	return proofs.reduce((total, proof) => total + proof.amount, 0);
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isSpentError(error: unknown): boolean {
	return /already spent|proofs? (are |is )?spent|token spent/i.test(errorText(error));
}

function describeMintError(mintUrl: string, error: unknown): Error {
	if (
		error instanceof NetworkError ||
		/failed to fetch|networkerror|load failed/i.test(errorText(error))
	) {
		return new Error(`Mint ${new URL(mintUrl).host} is unreachable. Try again in a moment.`);
	}
	return error instanceof Error ? error : new Error(errorText(error));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException('Aborted', 'AbortError'));
			return;
		}
		const timeout = setTimeout(resolve, ms);
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(timeout);
				reject(new DOMException('Aborted', 'AbortError'));
			},
			{ once: true }
		);
	});
}

class CashuWalletService {
	public state = $state<WalletState>({
		proofsByMint: {},
		pendingQuote: null,
		pendingSends: [],
		fundedCount: 0,
		loaded: false
	});

	private wallets = new Map<string, Promise<Wallet>>();
	private meltQuotes = new Map<string, { mintUrl: string; quote: MeltQuoteBolt11Response }>();
	private lock: Promise<unknown> = Promise.resolve();
	private initPromise: Promise<void> | null = null;

	get balance(): number {
		return Object.values(this.state.proofsByMint).reduce((total, proofs) => total + sum(proofs), 0);
	}

	/** Sats in provider tokens whose outcome isn't settled yet (recoverable via `reclaimAll`). */
	get pendingBalance(): number {
		return sum(this.state.pendingSends.filter((send) => send.kind !== 'export'));
	}

	/** Exported tokens nobody has redeemed yet, newest first. */
	get exportedTokens(): PendingSend[] {
		return this.state.pendingSends
			.filter((send) => send.kind === 'export')
			.sort((a, b) => b.createdAt - a.createdAt);
	}

	get mintUrl(): string {
		return CASHU_MINT_URL;
	}

	get topupPromptSeen(): boolean {
		return browser && localStorage.getItem(TOPUP_PROMPT_SEEN_KEY) === '1';
	}

	markTopupPromptSeen(): void {
		if (browser) {
			localStorage.setItem(TOPUP_PROMPT_SEEN_KEY, '1');
		}
	}

	init(): Promise<void> {
		if (!browser) {
			return Promise.resolve();
		}
		this.initPromise ??= this.load();
		return this.initPromise;
	}

	/** Creates a Lightning invoice at the mint and remembers it so a reload can resume. */
	async createInvoice(amount: number): Promise<PendingQuote> {
		const mintUrl = CASHU_MINT_URL;
		try {
			const wallet = await this.getWallet(mintUrl);
			const quote = await wallet.createMintQuoteBolt11(amount);
			const pending: PendingQuote = {
				mintUrl,
				quote: quote.quote,
				request: quote.request,
				amount,
				expiry: quote.expiry
			};
			this.state.pendingQuote = pending;
			this.persist();
			return pending;
		} catch (error) {
			throw describeMintError(mintUrl, error);
		}
	}

	clearPendingQuote(): void {
		this.state.pendingQuote = null;
		this.persist();
	}

	/**
	 * Polls the pending quote until it is paid and minted. Resolves with the minted
	 * amount; rejects on expiry, abort, or a mint error.
	 */
	async waitForInvoice(signal?: AbortSignal): Promise<number> {
		const pending = this.state.pendingQuote;
		if (!pending) {
			throw new Error('No pending invoice.');
		}

		const wallet = await this.getWallet(pending.mintUrl);
		for (;;) {
			if (pending.expiry && Date.now() / 1000 > pending.expiry) {
				this.clearPendingQuote();
				throw new Error('The invoice expired. Create a new one.');
			}

			let state: MintQuoteState;
			try {
				state = (await wallet.checkMintQuoteBolt11(pending.quote)).state;
			} catch (error) {
				// Transient mint hiccups shouldn't abandon an invoice the user may have paid.
				console.warn('Failed to check mint quote:', error);
				await sleep(QUOTE_POLL_INTERVAL_MS, signal);
				continue;
			}

			if (state === MintQuoteState.PAID) {
				return this.mintPendingQuote(pending);
			}
			if (state === MintQuoteState.ISSUED) {
				if (this.state.pendingQuote?.quote !== pending.quote) {
					// We minted it ourselves meanwhile (init resumed it).
					return pending.amount;
				}
				// Already minted elsewhere (e.g. another tab); nothing left to claim.
				this.clearPendingQuote();
				throw new Error('This invoice was already redeemed.');
			}

			await sleep(QUOTE_POLL_INTERVAL_MS, signal);
		}
	}

	/**
	 * Splits off a token worth `amount` sats. The token is recorded as a pending
	 * send until `settleSend` or `reclaimSend` is called.
	 *
	 * With `acceptedMints`, only those mints are spent from, so a provider is never
	 * handed a token it will reject.
	 */
	createToken(
		amount: number,
		acceptedMints?: string[],
		kind: PendingSend['kind'] = 'provider'
	): Promise<PendingSend> {
		return this.withLock(async () => {
			const accepted = acceptedMints?.map(normalizeMintUrl);
			const mintUrl = this.pickMintFor(amount, accepted);
			if (!mintUrl) {
				if (accepted && this.pickMintFor(amount)) {
					throw new UnacceptedMintError(accepted, this.fundedMints());
				}
				throw new InsufficientFundsError(amount, this.balance);
			}

			const wallet = await this.getWallet(mintUrl);
			let sendProofs: Proof[];
			try {
				sendProofs = await this.sendFromMint(wallet, mintUrl, amount);
			} catch (error) {
				if (error instanceof InsufficientFundsError) {
					throw error;
				}
				if (!isSpentError(error) && !/not enough/i.test(errorText(error))) {
					throw describeMintError(mintUrl, error);
				}
				// Stale proofs (spent elsewhere) — prune them and try once more.
				await this.pruneSpentProofs(wallet, mintUrl);
				if (sum(this.state.proofsByMint[mintUrl] ?? []) < amount) {
					throw new InsufficientFundsError(amount, this.balance);
				}
				sendProofs = await this.sendFromMint(wallet, mintUrl, amount);
			}

			const proofs = toStored(sendProofs);
			const pending: PendingSend = {
				id: crypto.randomUUID(),
				kind,
				mintUrl,
				token: getEncodedToken({ mint: mintUrl, proofs: sendProofs, unit: 'sat' }),
				proofs,
				amount: sum(proofs),
				createdAt: Date.now()
			};
			this.state.pendingSends = [...this.state.pendingSends, pending];
			this.persist();
			return pending;
		});
	}

	/** Receives a token (e.g. change from a provider) into the wallet. Returns the sats received. */
	receiveToken(token: string): Promise<number> {
		return this.withLock(() => this.receiveUnlocked(token));
	}

	/**
	 * Hands `amount` sats out of the wallet as an ecash token. The token stays in
	 * `exportedTokens` until the mint reports it redeemed (`refreshExports`) or the
	 * user takes it back (`reclaimSend`).
	 */
	async exportToken(amount: number): Promise<string> {
		const pending = await this.createToken(amount, undefined, 'export');
		return pending.token;
	}

	/** Drops exported tokens the recipient has redeemed. Never reclaims anything. */
	refreshExports(): Promise<void> {
		return this.withLock(async () => {
			for (const pending of this.state.pendingSends.filter((send) => send.kind === 'export')) {
				try {
					if ((await this.sendState(pending)) === 'spent') {
						this.settleSend(pending.id);
					}
				} catch (error) {
					console.warn('Could not check exported Cashu token:', error);
				}
			}
		});
	}

	/** Reclaims every unsettled provider token. Returns the sats recovered; throws if any is still stuck. */
	async reclaimAll(): Promise<number> {
		let recovered = 0;
		let lastError: unknown = null;
		for (const pending of this.state.pendingSends.filter((send) => send.kind !== 'export')) {
			try {
				recovered += await this.reclaimSend(pending.id);
			} catch (error) {
				lastError = error;
			}
		}
		if (lastError) {
			throw lastError;
		}
		return recovered;
	}

	/**
	 * Asks the mint what paying `invoice` would cost. The quote is held in memory
	 * for `payInvoice`; mints expire them after a minute or so.
	 */
	async quoteWithdrawal(invoice: string): Promise<WithdrawalQuote> {
		const mintUrl = this.richestMint();
		try {
			const wallet = await this.getWallet(mintUrl);
			const quote = await wallet.createMeltQuoteBolt11(invoice.trim());
			const amount = quote.amount.toNumber();
			const feeReserve = quote.fee_reserve.toNumber();
			this.meltQuotes.set(quote.quote, { mintUrl, quote });
			return { id: quote.quote, mintUrl, amount, feeReserve, total: amount + feeReserve };
		} catch (error) {
			throw describeMintError(mintUrl, error);
		}
	}

	/** Pays a quoted invoice. Returns the sats that actually left the wallet. */
	payInvoice(quoteId: string): Promise<number> {
		return this.withLock(async () => {
			const entry = this.meltQuotes.get(quoteId);
			if (!entry) {
				throw new Error('This withdrawal quote expired. Paste the invoice again.');
			}

			const { mintUrl, quote } = entry;
			const total = quote.amount.toNumber() + quote.fee_reserve.toNumber();
			const wallet = await this.getWallet(mintUrl);
			const spent = await this.sendFromMint(wallet, mintUrl, total);

			let result;
			try {
				result = await wallet.meltProofsBolt11(quote, spent);
			} catch (error) {
				await this.recoverFailedMelt(wallet, mintUrl, quoteId, spent);
				throw describeMintError(mintUrl, error);
			}

			this.meltQuotes.delete(quoteId);
			// The mint returns the unused part of the fee reserve.
			const change = toStored(result.change);
			this.addProofs(mintUrl, change);
			this.persist();
			return sum(toStored(spent)) - sum(change);
		});
	}

	/** The provider kept the token; stop tracking it. */
	settleSend(id: string): void {
		this.state.pendingSends = this.state.pendingSends.filter((send) => send.id !== id);
		this.persist();
	}

	/**
	 * Tries to take an unredeemed token back. The mint's proof states decide the
	 * outcome: spent means the recipient redeemed it and the entry is dropped;
	 * unspent is received back; anything else (in-flight proofs, unreachable mint,
	 * a failed swap) keeps the entry for a later attempt.
	 */
	reclaimSend(id: string): Promise<number> {
		return this.withLock(async () => {
			const pending = this.state.pendingSends.find((send) => send.id === id);
			if (!pending) {
				return 0;
			}
			try {
				const state = await this.sendState(pending);
				if (state === 'spent') {
					this.settleSend(id);
					return 0;
				}
				if (state === 'pending') {
					throw new Error(
						'The mint reports this token as in use. Try recovering it again in a minute.'
					);
				}
				const received = await this.receiveUnlocked(pending.token);
				this.settleSend(id);
				return received;
			} catch (error) {
				throw describeMintError(pending.mintUrl, error);
			}
		});
	}

	private async load(): Promise<void> {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const saved = JSON.parse(raw) as Partial<WalletState>;
				this.state.proofsByMint = saved.proofsByMint ?? {};
				this.state.pendingQuote = saved.pendingQuote ?? null;
				// Entries saved before exports were tracked are all provider tokens.
				this.state.pendingSends = (saved.pendingSends ?? []).map((send) => ({
					...send,
					kind: send.kind ?? 'provider',
					proofs: send.proofs ?? []
				}));
			}
		} catch (error) {
			console.error('Failed to load Cashu wallet:', error);
		}
		this.state.loaded = true;

		await this.resumePendingQuote();
		for (const pending of this.state.pendingSends.filter((send) => send.kind === 'provider')) {
			try {
				await this.reclaimSend(pending.id);
			} catch (error) {
				console.warn('Could not reclaim pending Cashu token:', error);
			}
		}
		await this.refreshExports();
	}

	/**
	 * Asks the mint whether a sent token was redeemed. Entries saved without proofs
	 * report `unspent`, so reclaiming falls back to attempting a receive.
	 */
	private async sendState(pending: PendingSend): Promise<SendState> {
		if (pending.proofs.length === 0) {
			return 'unspent';
		}
		const wallet = await this.getWallet(pending.mintUrl);
		const states = await wallet.checkProofsStates(
			pending.proofs.map(({ id, secret }) => ({ id, secret }))
		);
		if (states.every((entry) => entry.state === CheckStateEnum.SPENT)) {
			return 'spent';
		}
		if (states.every((entry) => entry.state === CheckStateEnum.UNSPENT)) {
			return 'unspent';
		}
		return 'pending';
	}

	/** Mints a quote paid while the page was closed; drops expired ones. */
	private async resumePendingQuote(): Promise<void> {
		const pending = this.state.pendingQuote;
		if (!pending) {
			return;
		}
		try {
			const wallet = await this.getWallet(pending.mintUrl);
			const { state } = await wallet.checkMintQuoteBolt11(pending.quote);
			if (state === MintQuoteState.PAID) {
				await this.mintPendingQuote(pending);
			} else if (
				state === MintQuoteState.ISSUED ||
				(pending.expiry && Date.now() / 1000 > pending.expiry)
			) {
				this.clearPendingQuote();
			}
		} catch (error) {
			console.warn('Could not resume pending invoice:', error);
		}
	}

	private mintPendingQuote(pending: PendingQuote): Promise<number> {
		return this.withLock(async () => {
			// Another caller (e.g. init + open modal) may have minted it already.
			if (this.state.pendingQuote?.quote !== pending.quote) {
				return pending.amount;
			}
			const wallet = await this.getWallet(pending.mintUrl);
			const proofs = await wallet.mintProofsBolt11(pending.amount, pending.quote);
			this.addProofs(pending.mintUrl, toStored(proofs));
			this.state.pendingQuote = null;
			this.state.fundedCount += 1;
			this.persist();
			return pending.amount;
		});
	}

	private async sendFromMint(wallet: Wallet, mintUrl: string, amount: number): Promise<Proof[]> {
		const proofs = this.state.proofsByMint[mintUrl] ?? [];
		if (sum(proofs) < amount) {
			throw new InsufficientFundsError(amount, this.balance);
		}
		const { keep, send } = await wallet.send(amount, $state.snapshot(proofs) as ProofLike[], {
			includeFees: true
		});
		// Always replace: an exact-amount send leaves `keep` empty and must still drop the inputs.
		this.state.proofsByMint = { ...this.state.proofsByMint, [mintUrl]: toStored(keep) };
		this.persist();
		return send;
	}

	private async receiveUnlocked(token: string): Promise<number> {
		const mintUrl = normalizeMintUrl(getTokenMetadata(token).mint);
		const wallet = await this.getWallet(mintUrl);
		const proofs = toStored(await wallet.receive(token));
		this.addProofs(mintUrl, proofs);
		this.persist();
		return sum(proofs);
	}

	/**
	 * A melt that threw may still have paid: only take the proofs back when the mint
	 * says the quote is unpaid, otherwise they are spent and re-adding them would
	 * inflate the balance with coins the mint will reject.
	 */
	private async recoverFailedMelt(
		wallet: Wallet,
		mintUrl: string,
		quoteId: string,
		spent: Proof[]
	): Promise<void> {
		try {
			const { state } = await wallet.checkMeltQuoteBolt11(quoteId);
			if (state === MeltQuoteState.UNPAID) {
				this.addProofs(mintUrl, toStored(spent));
				this.persist();
				return;
			}
			if (state === MeltQuoteState.PAID) {
				this.meltQuotes.delete(quoteId);
			}
		} catch (error) {
			console.warn('Could not check melt quote after a failed payment:', error);
		}
	}

	private async pruneSpentProofs(wallet: Wallet, mintUrl: string): Promise<void> {
		const proofs = this.state.proofsByMint[mintUrl] ?? [];
		if (proofs.length === 0) {
			return;
		}
		// States come back in the same order as the proofs sent.
		const states = await wallet.checkProofsStates($state.snapshot(proofs));
		const unspent = proofs.filter((_, index) => states[index]?.state !== CheckStateEnum.SPENT);
		this.state.proofsByMint = { ...this.state.proofsByMint, [mintUrl]: unspent };
		this.persist();
	}

	/** The mint holding the most sats — withdrawals can only spend one mint at a time. */
	private richestMint(): string {
		const mints = Object.keys(this.state.proofsByMint);
		return mints.reduce(
			(best, url) =>
				sum(this.state.proofsByMint[url] ?? []) > sum(this.state.proofsByMint[best] ?? [])
					? url
					: best,
			CASHU_MINT_URL
		);
	}

	/** Prefers the configured mint; otherwise any (accepted) mint holding enough sats. */
	private pickMintFor(amount: number, acceptedMints?: string[]): string | null {
		const candidates = [
			CASHU_MINT_URL,
			...Object.keys(this.state.proofsByMint).filter((url) => url !== CASHU_MINT_URL)
		].filter((url) => !acceptedMints || acceptedMints.includes(url));
		return candidates.find((url) => sum(this.state.proofsByMint[url] ?? []) >= amount) ?? null;
	}

	private fundedMints(): string[] {
		return Object.keys(this.state.proofsByMint).filter(
			(url) => sum(this.state.proofsByMint[url] ?? []) > 0
		);
	}

	private addProofs(mintUrl: string, proofs: StoredProof[]): void {
		const existing = this.state.proofsByMint[mintUrl] ?? [];
		const secrets = new Set(existing.map((proof) => proof.secret));
		this.state.proofsByMint = {
			...this.state.proofsByMint,
			[mintUrl]: [...existing, ...proofs.filter((proof) => !secrets.has(proof.secret))]
		};
	}

	private getWallet(mintUrl: string): Promise<Wallet> {
		let wallet = this.wallets.get(mintUrl);
		if (!wallet) {
			wallet = (async () => {
				const instance = new Wallet(mintUrl, { unit: 'sat' });
				await instance.loadMint();
				return instance;
			})();
			// Don't cache failures, so the next call retries the mint.
			wallet.catch(() => this.wallets.delete(mintUrl));
			this.wallets.set(mintUrl, wallet);
		}
		return wallet;
	}

	private withLock<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.lock.then(fn, fn);
		this.lock = run.catch(() => undefined);
		return run;
	}

	private persist(): void {
		if (!browser) {
			return;
		}
		const { proofsByMint, pendingQuote, pendingSends } = this.state;
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ proofsByMint, pendingQuote, pendingSends }));
	}
}

export const cashuWallet = new CashuWalletService();
