import type { RequestOptions } from '@contextvm/mcp-sdk/shared/protocol.js';

/** Timeout for requests to the ContextBTC Bitcoin node MCP server. */
export const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Options for `client.callTool` against the Bitcoin node MCP server.
 *
 * `onprogress` makes the MCP client attach a progressToken to the request.
 * The server only splits large responses (e.g. a full block) into CEP-22
 * chunks when one is present; without it, it tries a single oversized Nostr
 * event that never arrives and the call times out.
 */
export const CALL_TOOL_OPTIONS = {
	onprogress: () => {},
	resetTimeoutOnProgress: true,
	timeout: REQUEST_TIMEOUT_MS
} as const satisfies RequestOptions;
