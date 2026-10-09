import { McpToolClient, requirePubkey } from './mcpToolClient';
import { requireCommonRelays } from './relay-pool';

/**
 * Electrum client that talks to a `contextbtc-electrs-server` over ContextVM
 * (MCP-over-Nostr). Each Electrum method is an MCP tool of the same name.
 * The server is read-only and does not forward subscriptions/notifications.
 */

/** ContextVM electrs server (hex pubkey, npub or nprofile), set at build time. */
export const ELECTRS_SERVER_PUBKEY = import.meta.env.VITE_CONTEXTBTC_ELECTRS_PUBKEY?.trim() ?? '';
export const ELECTRS_SERVER_PUBKEY_ENV = 'VITE_CONTEXTBTC_ELECTRS_PUBKEY';

export interface HeaderNotification {
	height: number;
	/** Raw block header (consensus hex). */
	hex: string;
}

export interface HistoryEntry {
	tx_hash: string;
	/** Confirmation height; 0 or -1 for mempool transactions. */
	height: number;
	fee?: number;
}

export interface MerkleProof {
	block_height: number;
	pos: number;
	merkle: string[];
}

export class ElectrumNostr extends McpToolClient {
	constructor(
		serverPubkey: string = ELECTRS_SERVER_PUBKEY,
		relays: string[] = requireCommonRelays()
	) {
		super(requirePubkey(serverPubkey, ELECTRS_SERVER_PUBKEY_ENV), relays, 'ContextBTC Wallet');
	}

	/** Current chain tip. */
	headersSubscribe(): Promise<HeaderNotification> {
		return this.call<HeaderNotification>('blockchain.headers.subscribe');
	}

	/** Raw block header (consensus hex) at `height`. */
	blockHeader(height: number): Promise<string> {
		return this.call<string>('blockchain.block.header', { height });
	}

	getHistory(scripthash: string): Promise<HistoryEntry[]> {
		return this.call<HistoryEntry[]>('blockchain.scripthash.get_history', { scripthash });
	}

	/** Raw transaction (consensus hex). */
	getTransaction(txid: string): Promise<string> {
		return this.call<string>('blockchain.transaction.get', { tx_hash: txid });
	}

	getMerkle(txid: string, height: number): Promise<MerkleProof> {
		return this.call<MerkleProof>('blockchain.transaction.get_merkle', { tx_hash: txid, height });
	}
}
