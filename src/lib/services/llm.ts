import OpenAI from 'openai';
import type {
	ChatCompletionMessageParam,
	ChatCompletionTool
} from 'openai/resources/chat/completions';
import { isAutoMode, type ChatMessage, type LLMConfig } from '$lib/types/chat-types';
import { FreeModelRotator, isRetryableError } from '$lib/services/auto-mode';

export interface SendMessageOptions {
	signal?: AbortSignal;
	onDelta?: (delta: string) => void;
	onReset?: (model: string) => void;
	tools?: ChatCompletionTool[];
}

export interface SendMessageResult {
	content: string;
	model: string;
	finishReason?: string;
	toolCalls?: Array<{
		id: string;
		functionName: string;
		arguments: string;
	}>;
}

export { APIError } from 'openai';

export function normalizeBaseURL(baseURL: string): string {
	let trimmed = baseURL.trim().replace(/\/+$/, '');

	if (!trimmed) {
		return '';
	}

	for (const suffix of ['/chat/completions', '/completions']) {
		if (trimmed.endsWith(suffix)) {
			trimmed = trimmed.slice(0, -suffix.length);
		}
	}

	if (/\/v\d+$/.test(trimmed)) {
		return trimmed;
	}

	return `${trimmed}/v1`;
}

function toOpenAiMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
	const mapped: ChatCompletionMessageParam[] = [];

	for (const message of messages) {
		if (message.role === 'system') {
			mapped.push({
				role: 'system' as const,
				content: message.content
			});
			continue;
		}

		if (message.role === 'tool') {
			if (!message.toolCallId) {
				console.warn('Skipping tool message without toolCallId:', message.id);
				continue;
			}

			mapped.push({
				role: 'tool' as const,
				tool_call_id: message.toolCallId,
				content: message.content
			});
			continue;
		}

		if (message.role === 'assistant' && message.toolCalls?.length) {
			mapped.push({
				role: 'assistant' as const,
				content: message.content || null,
				tool_calls: message.toolCalls.map((toolCall) => ({
					id: toolCall.id,
					type: 'function' as const,
					function: {
						name: toolCall.name,
						arguments: toolCall.arguments
					}
				}))
			});
			continue;
		}

		mapped.push({
			role: message.role,
			content: message.content
		});
	}

	return mapped;
}

function getDefaultHeaders(baseURL: string): Record<string, string> | undefined {
	const isOpenRouter = baseURL.includes('openrouter.ai');
	return isOpenRouter && typeof window !== 'undefined'
		? {
				'HTTP-Referer': window.location.origin,
				'X-Title': 'ContextBTC'
			}
		: undefined;
}

export class LLMService {
	private config: LLMConfig;
	private client: OpenAI;
	private autoMode: FreeModelRotator | null = null;
	private lastUsedModel: string | null = null;
	private static readonly STREAM_IDLE_TIMEOUT_MS = 30_000;

	constructor(config: LLMConfig) {
		this.config = config;
		this.client = this.createClient(config);
		this.autoMode = isAutoMode(config) ? new FreeModelRotator(this.client) : null;
	}

	public reconfigure(config: LLMConfig): void {
		this.config = config;
		this.client = this.createClient(config);
		this.autoMode = isAutoMode(config) ? new FreeModelRotator(this.client) : null;
	}

	public getConfig(): LLMConfig {
		return this.config;
	}

	public getActiveModel(): string | null {
		return this.lastUsedModel;
	}

	public async fetchModels(signal?: AbortSignal): Promise<string[]> {
		const response = await this.client.models.list(signal ? { signal } : undefined);
		return response.data.map((model) => model.id);
	}

	public async testConnection(): Promise<void> {
		await this.client.models.list();
	}

	public async sendMessage(
		messages: ChatMessage[],
		options: SendMessageOptions = {}
	): Promise<SendMessageResult> {
		const { onDelta, onReset, signal, tools } = options;

		if (!this.autoMode || this.config.model !== 'auto') {
			if (!this.config.model.trim()) {
				throw new Error('Select a model before sending a message.');
			}

			return this.streamChat(this.config.model, messages, onDelta, signal, tools);
		}

		const models = await this.autoMode.getModels();
		if (models.length === 0) {
			throw new Error('No free models available');
		}

		let model = await this.autoMode.getCurrentModel();
		let lastError: unknown;
		const maxAttempts = Math.min(models.length, 3);

		for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
			if (!model) {
				break;
			}

			if (attempt > 0) {
				onReset?.(model);
			}

			try {
				return await this.streamChat(model, messages, onDelta, signal, tools);
			} catch (error) {
				lastError = error;

				if (!isRetryableError(error)) {
					throw error;
				}

				model = await this.autoMode.advanceModel();
			}
		}

		throw lastError instanceof Error
			? lastError
			: new Error('Failed to send message with free models');
	}

	private createClient(config: LLMConfig): OpenAI {
		const baseURL = normalizeBaseURL(config.baseURL);

		return new OpenAI({
			// ponytail: SDK throws at construction on an empty key; real auth errors
			// surface from the request itself and are handled by callers.
			apiKey: config.apiKey || 'missing-api-key',
			baseURL,
			defaultHeaders: getDefaultHeaders(baseURL),
			dangerouslyAllowBrowser: true
		});
	}

	private async streamChat(
		model: string,
		messages: ChatMessage[],
		onDelta: ((delta: string) => void) | undefined,
		signal: AbortSignal | undefined,
		tools: ChatCompletionTool[] | undefined
	): Promise<SendMessageResult> {
		const controller = new AbortController();
		const handleAbort = () => controller.abort();
		if (signal) {
			if (signal.aborted) {
				controller.abort();
			}
			signal.addEventListener('abort', handleAbort, { once: true });
		}

		let idleTimeoutId: ReturnType<typeof setTimeout> | null = null;
		let timedOut = false;
		const resetIdleTimeout = () => {
			if (idleTimeoutId) {
				clearTimeout(idleTimeoutId);
			}
			idleTimeoutId = setTimeout(() => {
				timedOut = true;
				controller.abort();
			}, LLMService.STREAM_IDLE_TIMEOUT_MS);
		};

		const stream = await this.client.chat.completions.create(
			{
				model,
				messages: toOpenAiMessages(messages),
				stream: true,
				...(tools?.length ? { tools } : {})
			},
			{
				signal: controller.signal
			}
		);

		let content = '';
		let finishReason = 'stop';
		const toolCallAccumulator = new Map<number, { id: string; name: string; args: string }>();

		try {
			resetIdleTimeout();
			for await (const chunk of stream) {
				resetIdleTimeout();
				const choice = chunk.choices[0];
				if (!choice) {
					continue;
				}

				if (choice.finish_reason) {
					finishReason = choice.finish_reason;
				}

				const delta = choice.delta;
				if (delta?.content) {
					content += delta.content;
					onDelta?.(delta.content);
				}

				if (delta?.tool_calls) {
					for (const toolCall of delta.tool_calls) {
						const existing = toolCallAccumulator.get(toolCall.index) ?? {
							id: '',
							name: '',
							args: ''
						};

						if (toolCall.id) {
							existing.id = toolCall.id;
						}
						if (toolCall.function?.name) {
							const chunkName = toolCall.function.name;
							if (!existing.name) {
								existing.name = chunkName;
							} else if (existing.name === chunkName) {
								// Already matched
							} else if (chunkName.startsWith(existing.name)) {
								// The chunk contains the full name, overwrite to avoid duplicates
								existing.name = chunkName;
							} else {
								existing.name += chunkName;
							}
						}
						if (toolCall.function?.arguments) {
							existing.args += toolCall.function.arguments;
						}

						toolCallAccumulator.set(toolCall.index, existing);
					}
				}
			}
		} finally {
			if (idleTimeoutId) {
				clearTimeout(idleTimeoutId);
			}
			if (signal) {
				signal.removeEventListener('abort', handleAbort);
			}
		}

		if (timedOut) {
			throw new Error('LLM response timed out');
		}

		const toolCalls =
			toolCallAccumulator.size > 0
				? [...toolCallAccumulator.values()]
						.filter((toolCall) => toolCall.id && toolCall.name)
						.map((toolCall) => ({
							id: toolCall.id,
							functionName: toolCall.name,
							arguments: toolCall.args
						}))
				: undefined;

		this.lastUsedModel = model;
		return { content, model, finishReason, toolCalls };
	}
}
