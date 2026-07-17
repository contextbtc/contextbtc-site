import { NostrClientTransport, PrivateKeySigner } from '@contextvm/sdk';
import { Client } from '@contextvm/mcp-sdk/client/index.js';
import type { ListToolsResult } from '@contextvm/mcp-sdk/types.js';
import { commonRelays } from './relay-pool';

export type McpTool = ListToolsResult['tools'][number];

const CLIENT_CONFIG = {
	name: 'ContextBTC Web Client',
	version: '0.0.1'
} as const;

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Connects to a ContextVM MCP server over Nostr and lists all of its tools.
 *
 * An ephemeral key is generated per call so no login is required to browse a
 * public server. Relays are used for CEP-17 discovery of the server's own
 * relay list; the transport falls back to them as operational relays too.
 */
export async function listServerTools(serverPubkey: string): Promise<McpTool[]> {
	const signer = new PrivateKeySigner();

	const transport = new NostrClientTransport({
		signer,
		serverPubkey,
		discoveryRelayUrls: commonRelays,
		fallbackOperationalRelayUrls: commonRelays
	});

	const client = new Client(CLIENT_CONFIG);

	try {
		await client.connect(transport);

		const tools: McpTool[] = [];
		let cursor: string | undefined;

		do {
			const result: ListToolsResult = await client.listTools(cursor ? { cursor } : undefined, {
				timeout: REQUEST_TIMEOUT_MS
			});
			console.log('result', result);
			tools.push(...result.tools);
			cursor = result.nextCursor;
		} while (cursor);

		return tools;
	} finally {
		await client.close();
	}
}
