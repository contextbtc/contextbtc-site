import { NostrClientTransport, PrivateKeySigner } from '@contextvm/sdk';
import { Client } from '@contextvm/mcp-sdk/client/index.js';
import type { CallToolResult } from '@contextvm/mcp-sdk/types.js';
import { CALL_TOOL_OPTIONS } from './mcp-request-options';

/**
 * Minimal MCP client for a ContextVM server whose tools return their result as
 * a single JSON text block (the ContextBTC bitcoind and electrs servers).
 *
 * An ephemeral Nostr key is generated per connection, so no login is needed.
 */
export class McpToolClient {
	private client: Client | null = null;

	constructor(
		private readonly serverPubkey: string,
		private readonly relays: string[],
		private readonly clientName: string
	) {}

	async connect(): Promise<void> {
		if (this.client) return;
		const transport = new NostrClientTransport({
			signer: new PrivateKeySigner(),
			serverPubkey: this.serverPubkey,
			relayHandler: this.relays
		});
		const client = new Client({ name: this.clientName, version: '0.0.1' });
		await client.connect(transport);
		this.client = client;
	}

	async close(): Promise<void> {
		await this.client?.close();
		this.client = null;
	}

	/** Invokes an MCP tool and JSON-parses the textual result. */
	async call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
		if (!this.client) throw new Error(`${this.clientName} is not connected`);

		const result = (await this.client.callTool(
			{ name: tool, arguments: args },
			undefined,
			CALL_TOOL_OPTIONS
		)) as CallToolResult;

		const text =
			result.content.find((c): c is { type: 'text'; text: string } => c.type === 'text')?.text ??
			'null';

		if (result.isError) {
			throw new Error(`${tool} failed: ${text}`);
		}

		return JSON.parse(text) as T;
	}
}

/** Returns `pubkey`, or throws naming the env var that should have set it. */
export function requirePubkey(pubkey: string, envVar: string): string {
	if (!pubkey) throw new Error(`${envVar} is not set; add it to .env (see .env.example).`);
	return pubkey;
}
