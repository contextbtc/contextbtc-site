import type { ToolApprovalTier } from '$lib/types/chat-types';
import type { Tool } from '@contextvm/mcp-sdk/types.js';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import Ajv, { type ValidateFunction } from 'ajv';

const MAX_FUNCTION_NAME_LENGTH = 64;
const MAX_TOOL_ARGS_CHARS = 64 * 1024;
const ajv = new Ajv({ allErrors: true, strict: false });

interface ToolMapping {
	serverName: string;
	originalName: string;
	tier: ToolApprovalTier;
	openAITool: ChatCompletionTool;
	validator?: ValidateFunction<unknown>;
}

type ParsedArguments = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

export type ToolResolveResult =
	| { ok: true; value: ResolvedToolCall }
	| { ok: false; reason: 'unknown_tool' | 'invalid_arguments'; error: string };

export interface ResolvedToolCall {
	serverName: string;
	originalToolName: string;
	args: Record<string, unknown>;
	tier: ToolApprovalTier;
}

/** OpenAI function names accept `[a-zA-Z0-9_-]{1,64}` only. */
function sanitizeFunctionName(value: string): string {
	const sanitized = value
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '');

	return (sanitized || 'tool').slice(0, MAX_FUNCTION_NAME_LENGTH).replace(/_+$/g, '') || 'tool';
}

function stripSchemaMeta(schema: Record<string, unknown>): Record<string, unknown> {
	const { $schema: _, ...rest } = schema;
	return rest;
}

function toParameters(inputSchema: Tool['inputSchema']): Record<string, unknown> {
	if (!inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) {
		return { type: 'object', properties: {} };
	}

	const parameters = stripSchemaMeta(inputSchema as Record<string, unknown>);
	return Object.keys(parameters).length > 0 ? parameters : { type: 'object', properties: {} };
}

function parseToolArguments(rawArgs: string): ParsedArguments {
	if (!rawArgs.trim()) {
		return { ok: true, value: {} };
	}

	if (rawArgs.length > MAX_TOOL_ARGS_CHARS) {
		return { ok: false, error: `Arguments payload exceeds ${MAX_TOOL_ARGS_CHARS} characters.` };
	}

	try {
		const parsed = JSON.parse(rawArgs) as unknown;
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? { ok: true, value: parsed as Record<string, unknown> }
			: { ok: false, error: 'Tool arguments must be a JSON object.' };
	} catch (_error) {
		return { ok: false, error: 'Arguments are not valid JSON.' };
	}
}

export function mcpToolToOpenAI(tool: Tool, serverName: string): ChatCompletionTool {
	return {
		type: 'function',
		function: {
			name: sanitizeFunctionName(tool.name),
			description: tool.description || `Tool from ${serverName}`,
			parameters: toParameters(tool.inputSchema)
		}
	};
}

/**
 * Maps the tools of the single hardcoded MCP server onto OpenAI function calls.
 *
 * Tool names are not namespaced: with one server there is nothing to collide
 * with, and the model gets to see the server's own vocabulary.
 */
export class ToolRegistry {
	private mappings = new Map<string, ToolMapping>();

	public register(
		serverName: string,
		tools: Tool[],
		tierOverrides?: Map<string, ToolApprovalTier>
	): void {
		for (const tool of tools) {
			const functionName = sanitizeFunctionName(tool.name);

			let validator: ValidateFunction<unknown> | undefined;
			if (tool.inputSchema && typeof tool.inputSchema === 'object') {
				try {
					validator = ajv.compile(stripSchemaMeta(tool.inputSchema as Record<string, unknown>));
				} catch (error) {
					console.warn(`Failed to compile schema for ${tool.name}:`, error);
				}
			}

			this.mappings.set(functionName, {
				serverName,
				originalName: tool.name,
				// Tools require approval unless explicitly marked auto.
				tier: tierOverrides?.get(tool.name) ?? tierOverrides?.get(functionName) ?? 'prompt',
				openAITool: mcpToolToOpenAI(tool, serverName),
				validator
			});
		}
	}

	public resolve(functionName: string, rawArgs: string): ToolResolveResult {
		const mapping = this.mappings.get(functionName);
		const args = parseToolArguments(rawArgs);
		const snippet = rawArgs.slice(0, 200);

		if (!mapping) {
			return { ok: false, reason: 'unknown_tool', error: `Unknown tool: ${functionName}` };
		}

		if (!args.ok) {
			return {
				ok: false,
				reason: 'invalid_arguments',
				error: `Malformed arguments JSON for ${functionName}: ${args.error}${
					snippet ? ` :: ${snippet}` : ''
				}`
			};
		}

		if (mapping.validator && !mapping.validator(args.value)) {
			return {
				ok: false,
				reason: 'invalid_arguments',
				error: `Schema validation failed for ${functionName}: ${ajv.errorsText(
					mapping.validator.errors
				)}`
			};
		}

		return {
			ok: true,
			value: {
				serverName: mapping.serverName,
				originalToolName: mapping.originalName,
				args: args.value,
				tier: mapping.tier
			}
		};
	}

	public getOpenAITools(): ChatCompletionTool[] {
		return [...this.mappings.values()].map((mapping) => mapping.openAITool);
	}

	public getSystemContext(): string {
		const names = [...this.mappings.keys()].sort();
		if (names.length === 0) {
			return '';
		}

		const serverName = [...this.mappings.values()][0].serverName;

		return [
			`You are connected to the "${serverName}" MCP server over Nostr, which exposes these tools:`,
			names.map((name) => `- ${name}`).join('\n'),
			'',
			'Use them whenever the user asks to query or interact with that server.',
			'Always explain what you are doing before and after calling a tool.'
		].join('\n');
	}

	public get size(): number {
		return this.mappings.size;
	}

	public clear(): void {
		this.mappings.clear();
	}
}
