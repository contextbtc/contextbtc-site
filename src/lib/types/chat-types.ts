export type ToolApprovalTier = 'auto' | 'prompt';

export interface ToolCallData {
	id: string;
	name: string;
	arguments: string;
	status: 'pending' | 'running' | 'approved' | 'completed' | 'rejected' | 'error';
	result?: string;
	serverName?: string;
	/** Original MCP tool name (un-namespaced). */
	originalToolName?: string;
}

export interface ChatMessage {
	id: string;
	content: string;
	role: 'user' | 'assistant' | 'system' | 'tool';
	timestamp: Date;
	toolCalls?: ToolCallData[];
	toolCallId?: string;
	toolName?: string;
}

export interface LLMConfig {
	provider: string;
	baseURL: string;
	apiKey: string;
	model: string;
}

export interface ProviderPreset {
	key: string;
	label: string;
	baseURL: string;
	requiresKey: boolean;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
	{
		key: 'openrouter',
		label: 'OpenRouter',
		baseURL: 'https://openrouter.ai/api/v1',
		requiresKey: true
	},
	{
		key: 'openai',
		label: 'OpenAI',
		baseURL: 'https://api.openai.com/v1',
		requiresKey: true
	},
	{
		key: 'ollama',
		label: 'Ollama',
		baseURL: 'http://localhost:11434/v1',
		requiresKey: false
	},
	{
		key: 'lmstudio',
		label: 'LM Studio',
		baseURL: 'http://localhost:1234/v1',
		requiresKey: false
	},
	{
		key: 'custom',
		label: 'Custom',
		baseURL: '',
		requiresKey: false
	}
];

/**
 * Users bring their own key via the chat's "Model" dialog. It is kept in their
 * browser's localStorage and never leaves it beyond the configured provider,
 * so there is deliberately no build-time default: this is a static site, and a
 * bundled key would be readable by every visitor.
 */
export const DEFAULT_LLM_CONFIG: LLMConfig = {
	provider: 'openrouter',
	baseURL: 'https://openrouter.ai/api/v1',
	apiKey: '',
	model: 'auto'
};

/** Auto mode rotates OpenRouter's `:free` models so no paid credits are needed. */
export function isAutoMode(config: LLMConfig): boolean {
	return config.model === 'auto' && config.baseURL.toLowerCase().includes('openrouter.ai');
}

export function requiresApiKey(config: LLMConfig): boolean {
	const preset = PROVIDER_PRESETS.find((candidate) => candidate.key === config.provider);
	return preset?.requiresKey ?? false;
}
