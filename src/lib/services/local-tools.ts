import type { CallToolResult, Tool } from '@contextvm/mcp-sdk/types.js';
import type { ToolApprovalTier } from '$lib/types/chat-types';
import type { ChatToolSource } from '$lib/services/agent-orchestrator';

/**
 * A tool that runs in the page itself (plain JS or WASM) instead of on a
 * remote MCP server. `definition` is the MCP `Tool` the model sees: its
 * `description` tells the model when to use it and `inputSchema` is used to
 * validate the arguments before `run` is called.
 */
export interface LocalTool {
	definition: Tool;
	/** Approval tier; defaults to `'prompt'` like any other tool. */
	tier?: ToolApprovalTier;
	run(args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult>;
}

/** Identity helper so tool literals are type-checked against {@link LocalTool}. */
export function defineLocalTool(tool: LocalTool): LocalTool {
	return tool;
}

/** A JSON result, as text for the model and as `structuredContent` for clients. */
export function jsonResult(value: Record<string, unknown>): CallToolResult {
	return {
		content: [{ type: 'text', text: JSON.stringify(value) }],
		structuredContent: value
	};
}

/**
 * Serves a fixed set of {@link LocalTool}s to the chat as if they were an MCP
 * server. Handler errors become MCP error results (`isError`), so the model
 * gets to read the message and explain or retry.
 */
export class LocalToolSource implements ChatToolSource {
	public readonly tierOverrides: Map<string, ToolApprovalTier>;
	private tools: Map<string, LocalTool>;

	constructor(
		public readonly serverName: string,
		public readonly description: string,
		tools: LocalTool[]
	) {
		this.tools = new Map(tools.map((tool) => [tool.definition.name, tool]));
		this.tierOverrides = new Map(
			tools.flatMap((tool) => (tool.tier ? [[tool.definition.name, tool.tier] as const] : []))
		);
	}

	public async listAllTools(): Promise<Tool[]> {
		return [...this.tools.values()].map((tool) => tool.definition);
	}

	public async callTool(
		toolName: string,
		args: Record<string, unknown>,
		signal?: AbortSignal
	): Promise<CallToolResult> {
		const tool = this.tools.get(toolName);
		if (!tool) {
			throw new Error(`Unknown tool: ${toolName}`);
		}
		if (signal?.aborted) {
			throw new Error('Tool execution stopped');
		}

		try {
			return await tool.run(args, signal);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { isError: true, content: [{ type: 'text', text: message }] };
		}
	}
}
