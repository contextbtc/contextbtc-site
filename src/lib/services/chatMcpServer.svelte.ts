import { NostrClientTransport, PrivateKeySigner } from '@contextvm/sdk';
import { Client } from '@contextvm/mcp-sdk/client/index.js';
import type { CallToolResult, ListToolsResult, Tool } from '@contextvm/mcp-sdk/types.js';
import { DEFAULT_SERVER_PUBKEY } from './bitcoinRpc';
import { commonRelays } from './relay-pool';

/**
 * The chat is pinned to a single, hardcoded ContextVM server instead of
 * discovering servers from Nostr relays: ContextBTC ships one known Bitcoin
 * node, so there is nothing for the user to pick.
 */
export const CHAT_SERVER = {
	label: 'ContextBTC Bitcoin node',
	pubkey: import.meta.env.BITCOINCORE_SERVER_PUBKEY?.trim() || DEFAULT_SERVER_PUBKEY,
	relays: commonRelays,
} as const;

const CLIENT_CONFIG = {
	name: 'ContextBTC Chat',
	version: '0.0.1'
} as const;

const REQUEST_TIMEOUT_MS = 60_000;

export interface McpConnectionState {
	connected: boolean;
	loading: boolean;
	error: string | null;
}

/**
 * Holds the one long-lived MCP client used by the chat.
 *
 * An ephemeral key is generated per connection so the chat works without a
 * Nostr login, matching the stateless client used elsewhere in the site.
 */
class ChatMcpServerService {
	public state = $state<McpConnectionState>({ connected: false, loading: false, error: null });
	public serverName = $state<string | null>(null);

	private client: Client | null = null;
	private connectPromise: Promise<Client | null> | null = null;

	public async getClient(): Promise<Client | null> {
		if (this.client) {
			return this.client;
		}

		if (this.connectPromise) {
			return this.connectPromise;
		}

		this.connectPromise = this.connect().finally(() => {
			this.connectPromise = null;
		});

		return this.connectPromise;
	}

	private async connect(): Promise<Client | null> {
		this.state = { connected: false, loading: true, error: null };

		try {
			const transport = new NostrClientTransport({
				signer: new PrivateKeySigner(),
				serverPubkey: CHAT_SERVER.pubkey,
				discoveryRelayUrls: [...CHAT_SERVER.relays],
				fallbackOperationalRelayUrls: [...CHAT_SERVER.relays],
				isStateless: true
			});

			const client = new Client(CLIENT_CONFIG);
			await client.connect(transport);

			this.client = client;
			this.serverName = client.getServerVersion()?.name ?? CHAT_SERVER.label;
			this.state = { connected: true, loading: false, error: null };
			return client;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to connect to server';
			this.state = { connected: false, loading: false, error: message };
			return null;
		}
	}

	private async getConnectedClientOrThrow(): Promise<Client> {
		const client = await this.getClient();
		if (!client) {
			throw new Error(this.state.error ?? 'Not connected to the ContextBTC server');
		}

		return client;
	}

	/** Lists every tool the server exposes, following pagination cursors. */
	public async listAllTools(): Promise<Tool[]> {
		const client = await this.getConnectedClientOrThrow();
		const tools: Tool[] = [];
		let cursor: string | undefined;

		do {
			const result: ListToolsResult = await client.listTools(cursor ? { cursor } : undefined, {
				timeout: REQUEST_TIMEOUT_MS
			});
			tools.push(...result.tools);
			cursor = result.nextCursor ?? undefined;
		} while (cursor);

		return tools;
	}

	public async callTool(
		toolName: string,
		args: Record<string, unknown>,
		signal?: AbortSignal
	): Promise<CallToolResult> {
		const client = await this.getConnectedClientOrThrow();

		if (signal?.aborted) {
			throw new Error('Tool execution stopped');
		}

		const result = await client.callTool({ name: toolName, arguments: args }, undefined, {
			timeout: REQUEST_TIMEOUT_MS,
			resetTimeoutOnProgress: true,
			signal
		});

		return result as CallToolResult;
	}

	public async disconnect(): Promise<void> {
		const client = this.client;
		this.client = null;
		this.serverName = null;
		this.state = { connected: false, loading: false, error: null };
		await client?.close();
	}
}

export const chatMcpServer = new ChatMcpServerService();
