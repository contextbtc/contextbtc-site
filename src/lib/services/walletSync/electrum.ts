import type { WalletWrapper } from '$lib/wasm/bdk/bdk';
import { ELECTRS_SERVER_PUBKEY, ElectrumNostr, type HistoryEntry } from '../electrumNostr';
import { loadOrCreateWallet, persist, RELAYS } from '../bdkWallet';
import type { SyncBackend, SyncProgress, SyncResult } from './types';

/**
 * Sync from an electrs server over ContextVM (MCP-over-Nostr), mirroring
 * `bdk_electrum`'s full scan: script histories are looked up per derivation
 * index until {@link STOP_GAP} unused scripts in a row, then the relevant
 * transactions, their merkle proofs and block headers are handed to the WASM
 * wallet, which checks the proofs and applies the result.
 */

/** Consecutive unused scripts after which a keychain scan stops. */
export const STOP_GAP = 20;
/** Electrum calls in flight at once. */
const CONCURRENCY = 8;

const KEYCHAINS = ['external', 'internal'] as const;
type Keychain = (typeof KEYCHAINS)[number];

/** Runs `fn` over `items`, at most {@link CONCURRENCY} at a time, keeping order. */
async function mapConcurrent<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
	return results;
}

/**
 * Looks up script histories of `keychain` until {@link STOP_GAP} unused
 * scripts in a row. Returns every history entry and the last used index.
 */
async function scanKeychain(
	electrum: ElectrumNostr,
	wallet: WalletWrapper,
	keychain: Keychain,
	onScanned: (count: number) => void
): Promise<{ history: HistoryEntry[]; lastActive?: number }> {
	const history: HistoryEntry[] = [];
	let lastActive: number | undefined;
	let start = 0;

	while (start - (lastActive ?? -1) - 1 < STOP_GAP) {
		const batch = JSON.parse(wallet.scripthashes(keychain, start, STOP_GAP)) as {
			index: number;
			scripthash: string;
		}[];
		const histories = await mapConcurrent(batch, (s) => electrum.getHistory(s.scripthash));
		histories.forEach((h, i) => {
			if (h.length === 0) return;
			lastActive = batch[i].index;
			history.push(...h);
		});
		start += batch.length;
		onScanned(batch.length);
	}

	return { history, lastActive };
}

/** Connects to the electrs server, loads/creates the wallet and scans it up to the tip. */
export async function syncWalletElectrum(
	onProgress?: (p: SyncProgress) => void
): Promise<SyncResult> {
	const electrum = new ElectrumNostr(ELECTRS_SERVER_PUBKEY, RELAYS);
	const wallet = await loadOrCreateWallet();

	try {
		await electrum.connect();
		const tip = await electrum.headersSubscribe();

		// 1. Script histories → txid → confirmation height (≤ 0 = mempool).
		let scanned = 0;
		const lastActive: Partial<Record<Keychain, number>> = {};
		const heights = new Map<string, number>();
		for (const keychain of KEYCHAINS) {
			const result = await scanKeychain(electrum, wallet, keychain, (count) => {
				scanned += count;
				onProgress?.({
					done: scanned,
					total: scanned + STOP_GAP,
					label: `Scanning ${keychain} addresses (${scanned} checked)`
				});
			});
			lastActive[keychain] = result.lastActive;
			for (const { tx_hash, height } of result.history) heights.set(tx_hash, height);
		}

		// 2. Raw transactions, plus a merkle proof for each confirmed one.
		const txids = [...heights.keys()];
		let fetched = 0;
		const report = () =>
			onProgress?.({
				done: fetched,
				total: txids.length,
				label: `Fetching transactions (${fetched} / ${txids.length})`
			});
		report();
		const fetchedTxs = await mapConcurrent(txids, async (txid) => {
			const height = heights.get(txid)!;
			const [hex, proof] = await Promise.all([
				electrum.getTransaction(txid),
				height > 0 ? electrum.getMerkle(txid, height) : null
			]);
			fetched++;
			report();
			return { txid, hex, proof };
		});

		// 3. Headers of every anchor block, and of the wallet's previous tip so a
		// reorg below the new tip replaces it.
		const confirmed = fetchedTxs.flatMap(({ txid, proof }) =>
			proof ? [{ txid, height: proof.block_height, pos: proof.pos, merkle: proof.merkle }] : []
		);
		const blockHeights = new Set(confirmed.map((c) => c.height));
		const previousTip = wallet.tip_height();
		if (previousTip > 0 && previousTip <= tip.height) blockHeights.add(previousTip);
		const blocks = await mapConcurrent([...blockHeights], async (height) => ({
			height,
			header: await electrum.blockHeader(height)
		}));

		wallet.apply_electrum_update(
			JSON.stringify({
				tip: { height: tip.height, header: tip.hex },
				blocks,
				txs: fetchedTxs.map((t) => t.hex),
				confirmed,
				last_active: lastActive
			}),
			BigInt(Math.floor(Date.now() / 1000))
		);
		persist(wallet);
		return { wallet, tip: tip.height, caughtUp: true };
	} finally {
		await electrum.close();
	}
}

export const electrumBackend: SyncBackend = {
	id: 'electrum',
	label: 'Electrum',
	description:
		'Synced by address lookups against an electrs server over ContextVM (Electrum over Nostr).',
	serverPubkey: ELECTRS_SERVER_PUBKEY,
	sync: syncWalletElectrum
};
