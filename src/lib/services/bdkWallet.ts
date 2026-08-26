import { browser } from '$app/environment';
import init, { WalletWrapper } from '$lib/wasm/bdk/bdk';
import bdkWasmUrl from '$lib/wasm/bdk/bdk_bg.wasm?url';
import { BitcoinRpc, DEFAULT_SERVER_PUBKEY } from './bitcoinRpc';
import { commonRelays } from './relay-pool';

/**
 * BDK WASM wallet service driven by bitcoind RPC over ContextVM (MCP-over-Nostr).
 *
 * The browser fetches blocks via {@link BitcoinRpc} and feeds them to the WASM
 * wallet with `apply_block`, mirroring `bdk_bitcoind_rpc::Emitter`. The wallet
 * is in-memory; its `ChangeSet` (including the synced chain tip) is persisted to
 * `localStorage`, so syncing resumes where it left off on the next load.
 */

export const NETWORK = 'regtest';
export const RELAYS = commonRelays;
export const SERVER_PUBKEY = DEFAULT_SERVER_PUBKEY;

export const EXTERNAL_DESCRIPTOR =
	"tr([12071a7c/86'/1'/0']tpubDCaLkqfh67Qr7ZuRrUNrCYQ54sMjHfsJ4yQSGb3aBr1yqt3yXpamRBUwnGSnyNnxQYu7rqeBiPfw3mjBcFNX4ky2vhjj9bDrGstkfUbLB9T/0/*)#z3x5097m";
export const INTERNAL_DESCRIPTOR =
	"tr([12071a7c/86'/1'/0']tpubDCaLkqfh67Qr7ZuRrUNrCYQ54sMjHfsJ4yQSGb3aBr1yqt3yXpamRBUwnGSnyNnxQYu7rqeBiPfw3mjBcFNX4ky2vhjj9bDrGstkfUbLB9T/1/*)#n9r4jswr";

/** Earliest height to sync from on a fresh wallet (0 = genesis). */
export const START_HEIGHT = 4300;
/** Cap on blocks applied per sync call, keeping the UI responsive. Resumable. */
export const MAX_BLOCKS_PER_SYNC = 5000;

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

export interface SyncProgress {
	/** Height of the block currently being applied. */
	height: number;
	/** Chain tip height reported by the RPC server. */
	tip: number;
	/** Height the sync started from this session. */
	from: number;
}

/** Loads a persisted wallet or creates a fresh one (no network access). */
async function loadOrCreateWallet(): Promise<WalletWrapper> {
	await ensureWasm();
	const stored = Store.load();
	if (stored) {
		return WalletWrapper.load(stored, EXTERNAL_DESCRIPTOR, INTERNAL_DESCRIPTOR);
	}
	return new WalletWrapper(NETWORK, EXTERNAL_DESCRIPTOR, INTERNAL_DESCRIPTOR);
}

/** Persists the wallet's staged changes, merging with any previous data. */
function persist(wallet: WalletWrapper): void {
	const previous = Store.load();
	Store.save(previous ? wallet.take_merged(previous) : wallet.take_staged());
}

/**
 * Connects to the RPC server, loads/creates the wallet, and syncs blocks from
 * the last checkpoint up to the chain tip (capped by {@link MAX_BLOCKS_PER_SYNC}).
 *
 * Returns the ready wallet plus whether the tip was reached this session.
 */
export async function syncWallet(
	onProgress?: (p: SyncProgress) => void
): Promise<{ wallet: WalletWrapper; tip: number; synced: number; caughtUp: boolean }> {
	const wallet = await loadOrCreateWallet();
	const rpc = new BitcoinRpc(SERVER_PUBKEY, RELAYS);

	try {
		await rpc.connect();
		const tip = await rpc.getBlockCount();

		// Establish the block to connect the next applied block to.
		let connHeight = wallet.tip_height();
		let connHash: string;
		let nextHeight: number;

		if (connHeight === 0) {
			// Fresh wallet: anchor to genesis, then start from START_HEIGHT.
			connHash = await rpc.getBlockHash(0);
			nextHeight = Math.max(START_HEIGHT, 1);
		} else {
			connHash = wallet.tip_hash();
			nextHeight = connHeight + 1;
		}

		const end = Math.min(tip, nextHeight + MAX_BLOCKS_PER_SYNC - 1);
		let synced = 0;

		for (let h = nextHeight; h <= end; h++) {
			// Get the block hash and hex from the RPC server and then
			// provide it to the wallet to apply the block.
			const hash = await rpc.getBlockHash(h);
			const blockHex = await rpc.getBlockHex(hash);
			wallet.apply_block(blockHex, h, connHeight, connHash);
			connHeight = h;
			connHash = hash;
			synced++;
			onProgress?.({ height: h, tip, from: nextHeight });
		}

		persist(wallet);
		return { wallet, tip, synced, caughtUp: end >= tip };
	} finally {
		await rpc.close();
	}
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
