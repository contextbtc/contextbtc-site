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

export const FREE_PROXY_PROVIDER_KEY = 'free-proxy';

export const PROVIDER_PRESETS: ProviderPreset[] = [
	{
		key: FREE_PROXY_PROVIDER_KEY,
		label: 'Free',
		// Our free-proxy server (free-proxy/), which holds the OpenRouter key.
		baseURL: import.meta.env.VITE_FREE_PROXY_URL?.trim() || 'http://localhost:8787/v1',
		requiresKey: false
	},
	{
		key: 'routstr',
		label: 'Routstr',
		baseURL: 'https://routstr1.purpleprometheus.com/v1',
		requiresKey: true
	},
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
 * Defaults to the free proxy so visitors can chat without a key. Users can
 * bring their own key via the chat's "Model" dialog; it is kept in their
 * browser's localStorage and never leaves it beyond the configured provider.
 * There is deliberately no build-time key: this is a static site, and a
 * bundled key would be readable by every visitor.
 */
export const DEFAULT_LLM_CONFIG: LLMConfig = {
	provider: FREE_PROXY_PROVIDER_KEY,
	baseURL: PROVIDER_PRESETS[0].baseURL,
	apiKey: '',
	model: 'auto'
};

/** The free proxy only serves OpenRouter's free models, without a user key. */
export function usesFreeProxy(config: LLMConfig): boolean {
	return config.provider === FREE_PROXY_PROVIDER_KEY;
}

/** Auto mode rotates OpenRouter's `:free` models so no paid credits are needed. */
export function isAutoMode(config: LLMConfig): boolean {
	return (
		config.model === 'auto' &&
		(usesFreeProxy(config) || config.baseURL.toLowerCase().includes('openrouter.ai'))
	);
}

export const ROUTSTR_PROVIDER_KEY = 'routstr';
export const ROUTSTR_DEFAULT_MODEL = '~deepseek/deepseek-v4-flash-latest';

/** Routstr without an API key pays per request from the local Cashu wallet. */
export function usesCashuWallet(config: LLMConfig): boolean {
	return config.provider === ROUTSTR_PROVIDER_KEY && !config.apiKey.trim();
}

export function requiresApiKey(config: LLMConfig): boolean {
	const preset = PROVIDER_PRESETS.find((candidate) => candidate.key === config.provider);
	return preset?.requiresKey ?? false;
}
