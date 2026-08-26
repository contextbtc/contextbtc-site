import { NostrClientTransport, PrivateKeySigner } from '@contextvm/sdk';
import { Client } from '@contextvm/mcp-sdk/client/index.js';
import type { CallToolResult } from '@contextvm/mcp-sdk/types.js';
import { commonRelays } from './relay-pool';

/**
 * Bitcoin Core JSON-RPC client that talks to a ContextVM MCP server over Nostr.
 *
 * Each RPC method is exposed by the server as an MCP tool (tool name == RPC
 * method name), so a `tools/call` maps 1:1 to a JSON-RPC call. The transport is
 * the browser-native `@contextvm/mcp-sdk` (websockets to Nostr relays) — the
 * Rust `bitcoincore_rpc` client cannot run in the browser (Tokio/native only).
 */

export const DEFAULT_SERVER_PUBKEY =
	'7807ffe23010b8961a1e1aecb1cbf82b58e7cf99401cbb7874b73e21b1b12629';

const CLIENT_CONFIG = {
	name: 'ContextBTC Wallet',
	version: '0.0.1'
} as const;

const REQUEST_TIMEOUT_MS = 60_000;

export interface BlockchainInfo {
	chain: string;
	blocks: number;
	bestblockhash: string;
	[key: string]: unknown;
}

export class BitcoinRpc {
	private client: Client | null = null;

	constructor(
		private readonly serverPubkey: string = DEFAULT_SERVER_PUBKEY,
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

		const result = (await this.client.callTool({ name: method, arguments: args }, undefined, {
			timeout: REQUEST_TIMEOUT_MS
		})) as CallToolResult;

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
