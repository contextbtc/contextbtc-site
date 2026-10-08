import { NostrClientTransport, PrivateKeySigner } from '@contextvm/sdk';
import { Client } from '@contextvm/mcp-sdk/client/index.js';
import type { CallToolResult } from '@contextvm/mcp-sdk/types.js';
import { CALL_TOOL_OPTIONS } from './mcp-request-options';
import { commonRelays } from './relay-pool';

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

if (!SERVER_PUBKEY) {
	throw new Error('VITE_CONTEXTBTC_SERVER_PUBKEY is not set; add it to .env (see .env.example).');
}

const CLIENT_CONFIG = {
	name: 'ContextBTC Wallet',
	version: '0.0.1'
} as const;

export interface BlockchainInfo {
	chain: string;
	blocks: number;
	bestblockhash: string;
	[key: string]: unknown;
}

export class BitcoinRpc {
	private client: Client | null = null;

	constructor(
		private readonly serverPubkey: string = SERVER_PUBKEY,
		private readonly relays: string[] = commonRelays
	) {}

	async connect(): Promise<void> {
		if (this.client) return;
		const signer = new PrivateKeySigner();
		const transport = new NostrClientTransport({
			signer,
			serverPubkey: this.serverPubkey,
			relayHandler: this.relays
		});
		const client = new Client(CLIENT_CONFIG);
		await client.connect(transport);
		this.client = client;
	}

	async close(): Promise<void> {
		await this.client?.close();
		this.client = null;
	}

	/** Invokes an RPC method (MCP tool) and JSON-parses the textual result. */
	async call<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
		if (!this.client) throw new Error('BitcoinRpc is not connected');

		const result = (await this.client.callTool(
			{ name: method, arguments: args },
			undefined,
			CALL_TOOL_OPTIONS
		)) as CallToolResult;

		const text =
			result.content.find((c): c is { type: 'text'; text: string } => c.type === 'text')?.text ??
			'null';

		if (result.isError) {
			throw new Error(`RPC ${method} failed: ${text}`);
		}

		return JSON.parse(text) as T;
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
