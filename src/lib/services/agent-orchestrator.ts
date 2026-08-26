import type { CallToolResult, Tool } from '@contextvm/mcp-sdk/types.js';
import type { ChatMessage, ToolCallData } from '$lib/types/chat-types';
import type { LLMService, SendMessageResult } from '$lib/services/llm';
import { ToolRegistry, type ToolResolveResult } from '$lib/services/mcp-openai-bridge';

/**
 * The single MCP server the chat talks to. Kept as an interface (rather than
 * importing the singleton) so the orchestrator stays free of `.svelte.ts` runes
 * and is unit-testable without the Svelte runtime.
 */
export interface ChatToolSource {
	readonly serverName: string | null;
	listAllTools(): Promise<Tool[]>;
	callTool(
		toolName: string,
		args: Record<string, unknown>,
		signal?: AbortSignal
	): Promise<CallToolResult>;
}

const DEFAULT_TOOL_APPROVAL_TIMEOUT_MS = 120_000;
const DEFAULT_REGISTRY_CACHE_MS = 60_000;
const DEFAULT_TOOL_CONCURRENCY = 4;

type PendingApproval = {
	resolve: () => void;
	reject: (reason: Error) => void;
};

export type AgentOrchestratorCallbacks = {
	onPreparingToolsChange?: (preparing: boolean) => void;
	/** The server could not be reached; this turn runs without its tools. */
	onToolsUnavailable?: (error: string) => void;
	onAssistantAdded?: (assistant: ChatMessage) => void;
	onAssistantDelta?: (assistant: ChatMessage, delta: string) => void;
	onAssistantReset?: (assistant: ChatMessage, model: string) => void;
	onAssistantUpdated?: (assistant: ChatMessage) => void;
	onToolStatusUpdated?: (assistant: ChatMessage, toolCallId: string) => void;
	onToolResultsAdded?: (toolResults: ChatMessage[]) => void;
	onMessageRemoved?: (messageId: string) => void;
	onModelUpdate?: (model: string) => void;
	onError?: (error: string) => void;
};

export type AgentOrchestratorRunOptions = {
	messages: ChatMessage[];
	signal: AbortSignal;
	callbacks?: AgentOrchestratorCallbacks;
};

export type AgentOrchestratorResult = {
	lastModel: string | null;
	error?: string;
};

/**
 * Drives the agent loop: stream the model, surface tool calls for approval,
 * execute the approved ones against the MCP server, feed results back.
 */
export class AgentOrchestrator {
	private toolApprovalTimeoutMs: number;
	private registryCacheMs: number;
	private toolConcurrency: number;
	private registryCache: { registry: ToolRegistry; timestamp: number } | null = null;
	private pendingApprovals = new Map<string, PendingApproval>();
	private llmService: LLMService;
	private toolSource: ChatToolSource;

	constructor(options: {
		llmService: LLMService;
		toolSource: ChatToolSource;
		toolApprovalTimeoutMs?: number;
		registryCacheMs?: number;
		toolConcurrency?: number;
	}) {
		this.llmService = options.llmService;
		this.toolSource = options.toolSource;
		this.toolApprovalTimeoutMs = options.toolApprovalTimeoutMs ?? DEFAULT_TOOL_APPROVAL_TIMEOUT_MS;
		this.registryCacheMs = options.registryCacheMs ?? DEFAULT_REGISTRY_CACHE_MS;
		this.toolConcurrency = Math.max(1, options.toolConcurrency ?? DEFAULT_TOOL_CONCURRENCY);
	}

	public approveToolCall(toolCallId: string): void {
		this.pendingApprovals.get(toolCallId)?.resolve();
	}

	public rejectToolCall(toolCallId: string): void {
		this.pendingApprovals.get(toolCallId)?.reject(new Error('User rejected tool call'));
	}

	public rejectPendingApprovals(reason: Error): void {
		for (const approval of [...this.pendingApprovals.values()]) {
			approval.reject(reason);
		}
		this.pendingApprovals.clear();
	}

	public invalidateRegistry(): void {
		this.registryCache = null;
	}

	public async run(options: AgentOrchestratorRunOptions): Promise<AgentOrchestratorResult> {
		const { messages, signal, callbacks } = options;
		let lastModel: string | null = null;

		try {
			const registry = await this.getOrBuildRegistry(callbacks);
			const tools = registry.getOpenAITools();
			const systemContext = registry.getSystemContext();
			const systemMessage = systemContext
				? {
						id: crypto.randomUUID(),
						content: systemContext,
						role: 'system' as const,
						timestamp: new Date()
					}
				: null;
			let outgoingMessages = this.withToolSystemContext(messages, systemMessage);
			let done = false;

			while (!done && !signal.aborted) {
				const rawAssistant: ChatMessage = {
					id: crypto.randomUUID(),
					content: '',
					role: 'assistant',
					timestamp: new Date()
				};
				messages.push(rawAssistant);
				// Retrieve the proxied reference so mutations trigger Svelte 5 reactivity.
				const assistant = messages[messages.length - 1];
				callbacks?.onAssistantAdded?.(assistant);

				const result = await this.llmService.sendMessage(outgoingMessages, {
					signal,
					tools: tools.length > 0 ? tools : undefined,
					onDelta: (delta) => {
						assistant.content += delta;
						callbacks?.onAssistantDelta?.(assistant, delta);
					},
					onReset: (model) => {
						assistant.content = '';
						assistant.toolCalls = undefined;
						callbacks?.onAssistantReset?.(assistant, model);
					}
				});

				if (signal.aborted) {
					if (!assistant.content && !assistant.toolCalls?.length) {
						this.removeMessage(messages, assistant.id, callbacks);
					}
					return { lastModel };
				}

				if (result.content && result.content !== assistant.content) {
					assistant.content = result.content;
					callbacks?.onAssistantUpdated?.(assistant);
				}
				lastModel = result.model;
				callbacks?.onModelUpdate?.(result.model);

				if (result.finishReason === 'tool_calls') {
					if (!result.toolCalls?.length) {
						assistant.content =
							assistant.content ||
							'Error: The model requested a tool call but did not provide a complete tool call.';
						callbacks?.onAssistantUpdated?.(assistant);
						break;
					}

					const resolvedMap = this.applyToolCallsToAssistantMessage(
						registry,
						assistant,
						result.toolCalls
					);
					callbacks?.onAssistantUpdated?.(assistant);

					const toolResultMessages = await this.executeToolCalls(
						resolvedMap,
						assistant,
						result.toolCalls,
						{
							signal,
							approvalTimeoutMs: this.toolApprovalTimeoutMs,
							onStatusUpdate: (toolCallId) =>
								callbacks?.onToolStatusUpdated?.(assistant, toolCallId)
						}
					);
					if (signal.aborted) {
						return { lastModel };
					}

					for (const toolResultMessage of toolResultMessages) {
						messages.push(toolResultMessage);
					}
					callbacks?.onToolResultsAdded?.(toolResultMessages);
					outgoingMessages = this.withToolSystemContext(messages, systemMessage);
					continue;
				}

				if (!assistant.content.trim()) {
					this.removeMessage(messages, assistant.id, callbacks);
				}

				done = true;
			}

			return { lastModel };
		} catch (error) {
			const latestAssistant = [...messages]
				.reverse()
				.find((message) => message.role === 'assistant');

			if (signal.aborted) {
				if (latestAssistant && !latestAssistant.content && !latestAssistant.toolCalls?.length) {
					this.removeMessage(messages, latestAssistant.id, callbacks);
				}
				return { lastModel };
			}

			const errorText = error instanceof Error ? error.message : 'Something went wrong.';
			if (latestAssistant) {
				latestAssistant.content = `Error: ${errorText}`;
				callbacks?.onAssistantUpdated?.(latestAssistant);
			}
			callbacks?.onError?.(errorText);
			return { lastModel, error: errorText };
		} finally {
			this.rejectPendingApprovals(new Error('Tool approval cancelled'));
		}
	}

	private removeMessage(
		messages: ChatMessage[],
		messageId: string,
		callbacks?: AgentOrchestratorCallbacks
	): void {
		const index = messages.findIndex((message) => message.id === messageId);
		if (index >= 0) {
			messages.splice(index, 1);
			callbacks?.onMessageRemoved?.(messageId);
		}
	}

	/**
	 * Builds the tool registry, or returns an empty one when the server is
	 * unreachable.
	 *
	 * A failed build is never cached: the next message retries the connection
	 * instead of pretending for `registryCacheMs` that the server has no tools.
	 * The failure is reported through `onToolsUnavailable` so the turn can
	 * continue while making it plain that the server was not consulted.
	 */
	private async getOrBuildRegistry(callbacks?: AgentOrchestratorCallbacks): Promise<ToolRegistry> {
		const now = Date.now();
		if (this.registryCache && now - this.registryCache.timestamp < this.registryCacheMs) {
			return this.registryCache.registry;
		}

		callbacks?.onPreparingToolsChange?.(true);
		try {
			const registry = new ToolRegistry();

			let tools;
			try {
				tools = await this.toolSource.listAllTools();
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Failed to list server tools';
				console.warn('Failed to list server tools:', error);
				callbacks?.onToolsUnavailable?.(message);
				return registry;
			}

			// Read the name only once connected — `listAllTools` is what resolves it.
			registry.register(this.toolSource.serverName ?? 'mcp_server', tools);
			this.registryCache = { registry, timestamp: Date.now() };
			return registry;
		} finally {
			callbacks?.onPreparingToolsChange?.(false);
		}
	}

	private withToolSystemContext(
		baseMessages: ChatMessage[],
		systemMessage: ChatMessage | null
	): ChatMessage[] {
		return systemMessage ? [systemMessage, ...baseMessages] : [...baseMessages];
	}

	private makeToolResultMessage(
		toolCallId: string,
		toolName: string,
		content: string
	): ChatMessage {
		return {
			id: crypto.randomUUID(),
			content,
			role: 'tool',
			timestamp: new Date(),
			toolCallId,
			toolName
		};
	}

	private updateToolCallStatus(
		message: ChatMessage,
		toolCallId: string,
		status: ToolCallData['status'],
		result?: string
	): void {
		const toolCall = message.toolCalls?.find((candidate) => candidate.id === toolCallId);
		if (!toolCall) {
			return;
		}

		toolCall.status = status;
		if (result !== undefined) {
			toolCall.result = result;
		}
	}

	private serializeToolResult(result: CallToolResult): string {
		const hasStructuredContent =
			result.structuredContent && Object.keys(result.structuredContent).length > 0;
		const hasContent = Array.isArray(result.content) && result.content.length > 0;

		if (!hasContent && !hasStructuredContent && !result.isError) {
			return '';
		}

		if (
			hasContent &&
			result.content?.length === 1 &&
			result.content[0].type === 'text' &&
			!hasStructuredContent &&
			!result.isError
		) {
			return result.content[0].text;
		}

		return JSON.stringify(
			{
				content: result.content ?? [],
				...(hasStructuredContent ? { structuredContent: result.structuredContent } : {}),
				...(result.isError ? { isError: result.isError } : {})
			},
			null,
			2
		);
	}

	private applyToolCallsToAssistantMessage(
		registry: ToolRegistry,
		assistantMessage: ChatMessage,
		toolCalls: NonNullable<SendMessageResult['toolCalls']>
	): Map<string, ToolResolveResult> {
		const resolvedMap = new Map<string, ToolResolveResult>();

		assistantMessage.toolCalls = toolCalls.map((toolCall) => {
			const resolved = registry.resolve(toolCall.functionName, toolCall.arguments);
			resolvedMap.set(toolCall.id, resolved);

			if (!resolved.ok) {
				return {
					id: toolCall.id,
					name: toolCall.functionName,
					arguments: toolCall.arguments,
					status: 'error' as const,
					result: `Error: ${resolved.error}`
				};
			}

			return {
				id: toolCall.id,
				name: toolCall.functionName,
				arguments: toolCall.arguments,
				status: resolved.value.tier === 'auto' ? ('running' as const) : ('pending' as const),
				serverName: resolved.value.serverName,
				originalToolName: resolved.value.originalToolName
			};
		});

		return resolvedMap;
	}

	private async executeToolCalls(
		resolvedMap: Map<string, ToolResolveResult>,
		assistantMessage: ChatMessage,
		toolCalls: NonNullable<SendMessageResult['toolCalls']>,
		options: {
			signal?: AbortSignal;
			approvalTimeoutMs?: number;
			onStatusUpdate?: (toolCallId: string) => void;
		} = {}
	): Promise<ChatMessage[]> {
		const { signal, onStatusUpdate, approvalTimeoutMs = this.toolApprovalTimeoutMs } = options;
		const markStatus = (toolCallId: string, status: ToolCallData['status'], result?: string) => {
			this.updateToolCallStatus(assistantMessage, toolCallId, status, result);
			onStatusUpdate?.(toolCallId);
		};
		const throwIfAborted = () => {
			if (signal?.aborted) {
				throw new Error('Tool execution stopped');
			}
		};

		const runTool = async (toolCall: NonNullable<SendMessageResult['toolCalls']>[number]) => {
			const resolved = resolvedMap.get(toolCall.id);
			if (!resolved || !resolved.ok) {
				const error =
					resolved && !resolved.ok ? `Error: ${resolved.error}` : 'Error: Tool not resolved';
				markStatus(toolCall.id, 'error', error);
				return this.makeToolResultMessage(toolCall.id, toolCall.functionName, error);
			}

			try {
				throwIfAborted();

				if (resolved.value.tier !== 'auto') {
					markStatus(toolCall.id, 'pending');
					await this.waitForUserApproval(toolCall.id, approvalTimeoutMs, signal);
					markStatus(toolCall.id, 'approved');
				}

				throwIfAborted();

				markStatus(toolCall.id, 'running');
				const result = await this.toolSource.callTool(
					resolved.value.originalToolName,
					resolved.value.args,
					signal
				);
				const serialized = this.serializeToolResult(result);
				markStatus(toolCall.id, 'completed', serialized);
				return this.makeToolResultMessage(toolCall.id, toolCall.functionName, serialized);
			} catch (error) {
				const errorText = error instanceof Error ? error.message : 'Tool call failed';
				const serialized = `Error: ${errorText}`;
				const status = errorText === 'User rejected tool call' ? 'rejected' : 'error';
				markStatus(toolCall.id, status, serialized);
				return this.makeToolResultMessage(toolCall.id, toolCall.functionName, serialized);
			}
		};

		const results: ChatMessage[] = new Array(toolCalls.length);
		let currentIndex = 0;
		const workerCount = Math.min(this.toolConcurrency, toolCalls.length);
		const workers = Array.from({ length: workerCount }, async () => {
			while (currentIndex < toolCalls.length) {
				const index = currentIndex;
				currentIndex += 1;
				try {
					results[index] = await runTool(toolCalls[index]);
				} catch (_error) {
					results[index] = this.makeToolResultMessage(
						toolCalls[index]?.id ?? crypto.randomUUID(),
						toolCalls[index]?.functionName ?? 'unknown_tool',
						'Error: Tool execution failed.'
					);
				}
			}
		});

		await Promise.all(workers);
		return results;
	}

	private waitForUserApproval(
		toolCallId: string,
		timeoutMs = this.toolApprovalTimeoutMs,
		signal?: AbortSignal
	): Promise<void> {
		return new Promise((resolve, reject) => {
			if (signal?.aborted) {
				reject(new Error('Tool execution stopped'));
				return;
			}

			let finished = false;
			let timeoutId: ReturnType<typeof setTimeout> | null = null;
			let onAbort = () => {};

			const finalize = (action: () => void) => {
				if (finished) {
					return;
				}

				finished = true;
				this.pendingApprovals.delete(toolCallId);
				if (timeoutId) {
					clearTimeout(timeoutId);
				}
				if (signal) {
					signal.removeEventListener('abort', onAbort);
				}
				action();
			};

			onAbort = () => finalize(() => reject(new Error('Tool execution stopped')));
			if (signal) {
				signal.addEventListener('abort', onAbort, { once: true });
			}

			timeoutId = setTimeout(() => {
				finalize(() => reject(new Error('Approval timed out')));
			}, timeoutMs);

			this.pendingApprovals.set(toolCallId, {
				resolve: () => finalize(resolve),
				reject: (reason) => finalize(() => reject(reason))
			});
		});
	}
}
