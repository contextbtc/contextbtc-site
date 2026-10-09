import { browser } from '$app/environment';
import init, { WalletWrapper, normalize_descriptors } from '$lib/wasm/bdk/bdk';
import bdkWasmUrl from '$lib/wasm/bdk/bdk_bg.wasm?url';
import { commonRelays } from './relay-pool';

/**
 * BDK WASM wallet core, independent of how the wallet is synced.
 *
 * The wallet is in-memory; its `ChangeSet` (including the synced chain tip) is
 * persisted to `localStorage`, so syncing resumes where it left off on the next
 * load. Each descriptor pair is its own wallet with its own storage key; every
 * sync backend (see `walletSync/`) loads and persists that same wallet, so
 * switching backend continues from what the other already synced.
 */

export const NETWORK = 'regtest';
export const RELAYS = commonRelays;

/** A watch-only wallet: its receive (external) and change (internal) descriptors. */
export interface WalletDescriptors {
	external: string;
	internal: string;
}

export const DEFAULT_DESCRIPTORS: WalletDescriptors = {
	external:
		"tr([12071a7c/86'/1'/0']tpubDCaLkqfh67Qr7ZuRrUNrCYQ54sMjHfsJ4yQSGb3aBr1yqt3yXpamRBUwnGSnyNnxQYu7rqeBiPfw3mjBcFNX4ky2vhjj9bDrGstkfUbLB9T/0/*)#z3x5097m",
	internal:
		"tr([12071a7c/86'/1'/0']tpubDCaLkqfh67Qr7ZuRrUNrCYQ54sMjHfsJ4yQSGb3aBr1yqt3yXpamRBUwnGSnyNnxQYu7rqeBiPfw3mjBcFNX4ky2vhjj9bDrGstkfUbLB9T/1/*)#n9r4jswr"
};

/** Where the last applied descriptor pair is remembered. */
const SELECTED_DESCRIPTORS_KEY = 'wallet:descriptors';
/** Where the default wallet lived before wallets were keyed by descriptors. */
const LEGACY_STORAGE_KEY = `walletData:${NETWORK}`;

/**
 * cyrb53: a small, fast, non-cryptographic string hash. It only has to name a
 * storage slot, and unlike `crypto.subtle` it is synchronous and available
 * outside secure contexts.
 */
function cyrb53(str: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** localStorage key of the wallet for `d` (expects normalized descriptors). */
function storageKey(d: WalletDescriptors): string {
	return `walletData:${NETWORK}:${cyrb53(`${d.external}\n${d.internal}`)}`;
}

const Store = {
	save(key: string, data: string | null): void {
		if (!browser || !data || data === 'null') return;
		localStorage.setItem(key, data);
	},
	load(key: string): string | null {
		if (!browser) return null;
		return localStorage.getItem(key);
	},
	clear(key: string): void {
		if (!browser) return;
		localStorage.removeItem(key);
	}
};

/** Moves the pre-descriptor-keys wallet (always the default pair) to its new key. */
function migrateLegacyStore(d: WalletDescriptors): void {
	if (!browser) return;
	if (d.external !== DEFAULT_DESCRIPTORS.external || d.internal !== DEFAULT_DESCRIPTORS.internal) {
		return;
	}
	const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
	if (legacy === null) return;
	if (localStorage.getItem(storageKey(d)) === null) localStorage.setItem(storageKey(d), legacy);
	localStorage.removeItem(LEGACY_STORAGE_KEY);
}

let wasmReady: Promise<unknown> | null = null;

function ensureWasm(): Promise<unknown> {
	if (!browser) throw new Error('BDK WASM can only run in the browser');
	if (!wasmReady) wasmReady = init({ module_or_path: bdkWasmUrl });
	return wasmReady;
}

/**
 * Validates a descriptor pair and returns it in canonical form (public keys,
 * with checksums), so equivalent inputs map to the same wallet. Throws with
 * BDK's message for invalid descriptors, and rejects private keys.
 */
export async function normalizeDescriptors(
	external: string,
	internal: string
): Promise<WalletDescriptors> {
	await ensureWasm();
	return JSON.parse(normalize_descriptors(NETWORK, external, internal)) as WalletDescriptors;
}

/** The last applied descriptor pair, or the default one. */
export function loadSelectedDescriptors(): WalletDescriptors {
	try {
		const saved = JSON.parse(localStorage.getItem(SELECTED_DESCRIPTORS_KEY) ?? 'null');
		if (typeof saved?.external === 'string' && typeof saved?.internal === 'string') {
			return { external: saved.external, internal: saved.internal };
		}
	} catch {
		// Storage unavailable or corrupt: use the default.
	}
	return DEFAULT_DESCRIPTORS;
}

export function saveSelectedDescriptors(d: WalletDescriptors): void {
	try {
		localStorage.setItem(SELECTED_DESCRIPTORS_KEY, JSON.stringify(d));
	} catch {
		// Storage unavailable: the choice just isn't remembered.
	}
}

/** Loads the wallet persisted for `d` or creates a fresh one (no network access). */
export async function loadOrCreateWallet(d: WalletDescriptors): Promise<WalletWrapper> {
	await ensureWasm();
	migrateLegacyStore(d);
	const stored = Store.load(storageKey(d));
	if (stored) {
		return WalletWrapper.load(stored, d.external, d.internal);
	}
	return new WalletWrapper(NETWORK, d.external, d.internal);
}

/** Persists the wallet's staged changes, merging with any previous data. */
export function persist(wallet: WalletWrapper, d: WalletDescriptors): void {
	const key = storageKey(d);
	const previous = Store.load(key);
	Store.save(key, previous ? wallet.take_merged(previous) : wallet.take_staged());
}

/** Total confirmed + unconfirmed balance in satoshis. */
export function getBalanceSats(wallet: WalletWrapper): bigint {
	return wallet.balance();
}

/** Reveals the next external address and persists the updated changeset. */
export function revealNextAddress(wallet: WalletWrapper, d: WalletDescriptors): string {
	const address = wallet.reveal_next_address();
	persist(wallet, d);
	return address;
}

/** Clears the persisted data of the wallet for `d` (forces a fresh sync next load). */
export function resetWallet(d: WalletDescriptors): void {
	Store.clear(storageKey(d));
}
