import { browser } from '$app/environment';
import init, { WalletWrapper } from '$lib/wasm/bdk/bdk';
import bdkWasmUrl from '$lib/wasm/bdk/bdk_bg.wasm?url';
import { commonRelays } from './relay-pool';

/**
 * BDK WASM wallet core, independent of how the wallet is synced.
 *
 * The wallet is in-memory; its `ChangeSet` (including the synced chain tip) is
 * persisted to `localStorage`, so syncing resumes where it left off on the next
 * load. There is one wallet: every sync backend (see `walletSync/`) loads and
 * persists the same one, so switching backend continues from what the other
 * already synced.
 */

export const NETWORK = 'regtest';
export const RELAYS = commonRelays;

export const EXTERNAL_DESCRIPTOR =
	"tr([12071a7c/86'/1'/0']tpubDCaLkqfh67Qr7ZuRrUNrCYQ54sMjHfsJ4yQSGb3aBr1yqt3yXpamRBUwnGSnyNnxQYu7rqeBiPfw3mjBcFNX4ky2vhjj9bDrGstkfUbLB9T/0/*)#z3x5097m";
export const INTERNAL_DESCRIPTOR =
	"tr([12071a7c/86'/1'/0']tpubDCaLkqfh67Qr7ZuRrUNrCYQ54sMjHfsJ4yQSGb3aBr1yqt3yXpamRBUwnGSnyNnxQYu7rqeBiPfw3mjBcFNX4ky2vhjj9bDrGstkfUbLB9T/1/*)#n9r4jswr";

// Based on the network, we use a different storage key.
const STORAGE_KEY = `walletData:${NETWORK}`;

const Store = {
	save(data: string | null): void {
		if (!browser || !data || data === 'null') return;
		localStorage.setItem(STORAGE_KEY, data);
	},
	load(): string | null {
		if (!browser) return null;
		return localStorage.getItem(STORAGE_KEY);
	},
	clear(): void {
		if (!browser) return;
		localStorage.removeItem(STORAGE_KEY);
	}
};

let wasmReady: Promise<unknown> | null = null;

function ensureWasm(): Promise<unknown> {
	if (!browser) throw new Error('BDK WASM can only run in the browser');
	if (!wasmReady) wasmReady = init({ module_or_path: bdkWasmUrl });
	return wasmReady;
}

/** Loads the persisted wallet or creates a fresh one (no network access). */
export async function loadOrCreateWallet(): Promise<WalletWrapper> {
	await ensureWasm();
	const stored = Store.load();
	if (stored) {
		return WalletWrapper.load(stored, EXTERNAL_DESCRIPTOR, INTERNAL_DESCRIPTOR);
	}
	return new WalletWrapper(NETWORK, EXTERNAL_DESCRIPTOR, INTERNAL_DESCRIPTOR);
}

/** Persists the wallet's staged changes, merging with any previous data. */
export function persist(wallet: WalletWrapper): void {
	const previous = Store.load();
	Store.save(previous ? wallet.take_merged(previous) : wallet.take_staged());
}

/** Total confirmed + unconfirmed balance in satoshis. */
export function getBalanceSats(wallet: WalletWrapper): bigint {
	return wallet.balance();
}

/** Reveals the next external address and persists the updated changeset. */
export function revealNextAddress(wallet: WalletWrapper): string {
	const address = wallet.reveal_next_address();
	persist(wallet);
	return address;
}

/** Clears the persisted wallet data (forces a fresh sync next load). */
export function resetWallet(): void {
	Store.clear();
}
