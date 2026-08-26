import { browser } from '$app/environment';
import type { ChatMessage } from '$lib/types/chat-types';

const STORAGE_KEY = 'contextbtc.chat.messages';
const MAX_PERSISTED_MESSAGES = 200;

/**
 * The chat is pinned to a single hardcoded server and a single conversation,
 * so history lives in localStorage rather than an IndexedDB conversation store.
 */
export function loadMessages(): ChatMessage[] {
	if (!browser) {
		return [];
	}

	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			return [];
		}

		const parsed = JSON.parse(raw) as ChatMessage[];
		if (!Array.isArray(parsed)) {
			return [];
		}

		return parsed.map((message) => ({
			...message,
			timestamp: new Date(message.timestamp)
		}));
	} catch (error) {
		console.warn('Failed to read chat history:', error);
		return [];
	}
}

export function saveMessages(messages: ChatMessage[]): void {
	if (!browser) {
		return;
	}

	try {
		const trimmed = messages.slice(-MAX_PERSISTED_MESSAGES);
		localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
	} catch (error) {
		console.warn('Failed to persist chat history:', error);
	}
}

export function clearMessages(): void {
	if (!browser) {
		return;
	}

	localStorage.removeItem(STORAGE_KEY);
}

const CONFIG_KEY = 'contextbtc.chat.llmConfig';

export function loadLLMConfig<T>(fallback: T): T {
	if (!browser) {
		return fallback;
	}

	try {
		const raw = localStorage.getItem(CONFIG_KEY);
		return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
	} catch (error) {
		console.warn('Failed to read LLM config:', error);
		return fallback;
	}
}

export function saveLLMConfig(config: unknown): void {
	if (!browser) {
		return;
	}

	try {
		localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
	} catch (error) {
		console.warn('Failed to persist LLM config:', error);
	}
}
