import { McpToolClient, requirePubkey } from './mcpToolClient';
import { requireCommonRelays } from './relay-pool';

/**
 * Bitcoin Core JSON-RPC client that talks to a ContextVM MCP server over Nostr.
 *
 * Each RPC method is exposed by the server as an MCP tool (tool name == RPC
 * method name), so a `tools/call` maps 1:1 to a JSON-RPC call. The transport is
 * the browser-native `@contextvm/mcp-sdk` (websockets to Nostr relays) — the
 * Rust `bitcoincore_rpc` client cannot run in the browser (Tokio/native only).
 */

/** ContextVM Bitcoin Core server (hex pubkey, npub or nprofile), set at build time. */
export const SERVER_PUBKEY = import.meta.env.VITE_CONTEXTBTC_SERVER_PUBKEY?.trim() ?? '';
export const SERVER_PUBKEY_ENV = 'VITE_CONTEXTBTC_SERVER_PUBKEY';

export interface BlockchainInfo {
	chain: string;
	blocks: number;
	bestblockhash: string;
	[key: string]: unknown;
}

export class BitcoinRpc extends McpToolClient {
	constructor(serverPubkey: string = SERVER_PUBKEY, relays: string[] = requireCommonRelays()) {
		super(requirePubkey(serverPubkey, SERVER_PUBKEY_ENV), relays, 'ContextBTC Wallet');
	}

	getBlockchainInfo(): Promise<BlockchainInfo> {
		return this.call<BlockchainInfo>('getblockchaininfo');
	}

	getBlockCount(): Promise<number> {
		return this.call<number>('getblockcount');
	}

	getBlockHash(height: number): Promise<string> {
		return this.call<string>('getblockhash', { height });
	}

	/** Raw consensus-encoded block as a hex string (`getblock <hash> 0`). */
	getBlockHex(blockhash: string): Promise<string> {
		return this.call<string>('getblock', { blockhash, verbosity: 0 });
	}
}
