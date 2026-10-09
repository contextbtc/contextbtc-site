import { BitcoinRpc, SERVER_PUBKEY } from '../bitcoinRpc';
import { loadOrCreateWallet, persist, type WalletDescriptors } from '../bdkWallet';
import type { SyncBackend, SyncProgress, SyncResult } from './types';

/**
 * Sync from bitcoind RPC over ContextVM (MCP-over-Nostr).
 *
 * The browser fetches blocks via {@link BitcoinRpc} and feeds them to the WASM
 * wallet with `apply_block`, mirroring `bdk_bitcoind_rpc::Emitter`.
 *
 * Each block is connected to the stored tip without re-checking its hash, so
 * the tip (possibly set by another backend) must come from the same chain as
 * this node, e.g. electrs indexing this same bitcoind.
 */

/**
 * Earliest height to sync from on a wallet no backend has synced yet (0 =
 * genesis). Otherwise RPC resumes from the stored tip, wherever it came from.
 */
export const START_HEIGHT = 0;
/** Cap on blocks applied per sync call, keeping the UI responsive. Resumable. */
export const MAX_BLOCKS_PER_SYNC = 5000;

/**
 * Connects to the RPC server, loads/creates the wallet, and syncs blocks from
 * the last checkpoint up to the chain tip (capped by {@link MAX_BLOCKS_PER_SYNC}).
 */
export async function syncWalletRpc(
	descriptors: WalletDescriptors,
	onProgress?: (p: SyncProgress) => void
): Promise<SyncResult> {
	const rpc = new BitcoinRpc(SERVER_PUBKEY);
	const wallet = await loadOrCreateWallet(descriptors);

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

		for (let h = nextHeight; h <= end; h++) {
			// Get the block hash and hex from the RPC server and then
			// provide it to the wallet to apply the block.
			const hash = await rpc.getBlockHash(h);
			const blockHex = await rpc.getBlockHex(hash);
			wallet.apply_block(blockHex, h, connHeight, connHash);
			connHeight = h;
			connHash = hash;
			onProgress?.({
				done: h - nextHeight + 1,
				total: tip - nextHeight + 1,
				label: `Syncing block ${h.toLocaleString('en-US')} / ${tip.toLocaleString('en-US')}`
			});
		}

		persist(wallet, descriptors);
		return { wallet, tip, caughtUp: end >= tip };
	} finally {
		await rpc.close();
	}
}

export const rpcBackend: SyncBackend = {
	id: 'rpc',
	label: 'Bitcoin RPC',
	description:
		'Synced block-by-block from a bitcoind node over ContextVM (Bitcoin RPC over Nostr).',
	serverPubkey: SERVER_PUBKEY,
	sync: syncWalletRpc
};
