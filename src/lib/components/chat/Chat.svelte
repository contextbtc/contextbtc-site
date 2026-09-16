<script lang="ts">
	import { onMount } from 'svelte';
	import {
		isAutoMode,
		usesCashuWallet,
		type ChatMessage,
		type LLMConfig
	} from '$lib/types/chat-types';
	import { LLMService } from '$lib/services/llm';
	import { AgentOrchestrator } from '$lib/services/agent-orchestrator';
	import { CHAT_SERVER, chatMcpServer } from '$lib/services/chatMcpServer.svelte';
	import { clearMessages, loadMessages, saveMessages } from '$lib/services/chat-history';
	import { cashuWallet } from '$lib/services/cashu-wallet.svelte';
	import { isInsufficientFundsMessage } from '$lib/services/routstr-payment';
	import { DIALOG_IDS, dialogState } from '$lib/stores/dialog-state.svelte';
	import ChatBubble from '$lib/components/chat/ChatBubble.svelte';
	import ChatInput from '$lib/components/chat/ChatInput.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import PlugIcon from '@lucide/svelte/icons/plug';
	import ServerIcon from '@lucide/svelte/icons/server';

	let {
		config,
		lastUsedModel = $bindable(''),
		autoApproveTools = false
	}: {
		config: LLMConfig;
		lastUsedModel?: string;
		autoApproveTools?: boolean;
	} = $props();

	let messages = $state<ChatMessage[]>([]);
	let isStreaming = $state(false);
	let isPreparingTools = $state(false);
	let errorMessage = $state<string | null>(null);
	let needsTopUp = $state(false);
	let toolsWarning = $state<string | null>(null);
	let llmService: LLMService | null = null;
	let orchestrator: AgentOrchestrator | null = null;
	let abortController: AbortController | null = null;
	let scrollRef = $state<HTMLDivElement | null>(null);
	let isNearBottom = $state(true);

	const connection = $derived(chatMcpServer.state);
	const autoModeEnabled = $derived(isAutoMode(config));
	const hasApiKey = $derived(config.apiKey.trim().length > 0);
	const payingWithCashu = $derived(usesCashuWallet(config));
	const canSend = $derived(hasApiKey || (payingWithCashu && cashuWallet.balance > 0));
	const inputPlaceholder = $derived(
		canSend
			? 'Ask about the Bitcoin node...'
			: payingWithCashu
				? 'Top up your wallet to start'
				: 'Add an API key to start'
	);

	const openTopUp = () => (dialogState.dialogId = DIALOG_IDS.WALLET);

	const showError = (message: string) => {
		errorMessage = message;
		needsTopUp = payingWithCashu && isInsufficientFundsMessage(message);
	};

	onMount(() => {
		messages = loadMessages();
		// Warm up the hardcoded server so its tools are ready on the first message.
		void chatMcpServer.getClient();

		return () => {
			abortController?.abort();
			orchestrator?.rejectPendingApprovals(new Error('Chat closed'));
		};
	});

	// Keep LLMService in sync with config changes without recreating the orchestrator.
	$effect(() => {
		if (!llmService) {
			llmService = new LLMService(config);
			orchestrator = new AgentOrchestrator({ llmService, toolSource: chatMcpServer });
		} else {
			llmService.reconfigure(config);
		}
	});

	// Rebuild the tool registry once the server connection flips.
	$effect(() => {
		void chatMcpServer.state.connected;
		orchestrator?.invalidateRegistry();
	});

	// Auto-approve pending tool calls when the toggle is enabled.
	$effect(() => {
		if (!autoApproveTools) {
			return;
		}

		for (const message of messages) {
			if (message.role !== 'assistant' || !message.toolCalls?.length) {
				continue;
			}

			for (const toolCall of message.toolCalls) {
				if (toolCall.status === 'pending') {
					approveToolCall(toolCall.id);
				}
			}
		}
	});

	$effect(() => {
		void messages.length;
		void isStreaming;
		if (!scrollRef) {
			return;
		}

		queueMicrotask(() => {
			if (isNearBottom) {
				scrollRef?.scrollTo({ top: scrollRef.scrollHeight, behavior: 'smooth' });
			}
		});
	});

	const approveToolCall = (toolCallId: string) => orchestrator?.approveToolCall(toolCallId);
	const rejectToolCall = (toolCallId: string) => orchestrator?.rejectToolCall(toolCallId);

	const updateIsNearBottom = () => {
		if (!scrollRef) {
			return;
		}

		const distance = scrollRef.scrollHeight - scrollRef.scrollTop - scrollRef.clientHeight;
		isNearBottom = distance < 160;
	};

	const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
		scrollRef?.scrollTo({ top: scrollRef.scrollHeight, behavior });
	};

	let persistTimeout: ReturnType<typeof setTimeout> | null = null;

	const debouncedPersist = (nextMessages: ChatMessage[], ms = 1000) => {
		if (persistTimeout) {
			clearTimeout(persistTimeout);
		}

		persistTimeout = setTimeout(() => {
			persistTimeout = null;
			saveMessages(nextMessages);
		}, ms);
	};

	export const newChat = () => {
		abortController?.abort();
		orchestrator?.rejectPendingApprovals(new Error('Chat cleared'));
		if (persistTimeout) {
			clearTimeout(persistTimeout);
			persistTimeout = null;
		}
		messages = [];
		errorMessage = null;
		toolsWarning = null;
		lastUsedModel = '';
		clearMessages();
	};

	const handleStop = () => {
		abortController?.abort();
		isPreparingTools = false;
		orchestrator?.rejectPendingApprovals(new Error('Tool execution stopped'));
	};

	const handleSend = async (content: string) => {
		if (!content.trim() || !llmService || !orchestrator || isStreaming) {
			return;
		}

		errorMessage = null;
		needsTopUp = false;
		toolsWarning = null;
		messages = [
			...messages,
			{ id: crypto.randomUUID(), content, role: 'user', timestamp: new Date() }
		];

		const streamMessages = messages;
		isStreaming = true;
		saveMessages(streamMessages);

		const controller = new AbortController();
		abortController = controller;

		try {
			const result = await orchestrator.run({
				messages: streamMessages,
				signal: controller.signal,
				callbacks: {
					onPreparingToolsChange: (preparing) => (isPreparingTools = preparing),
					onToolsUnavailable: (error) => (toolsWarning = error),
					onAssistantDelta: () => {
						debouncedPersist(streamMessages);
						if (isNearBottom) {
							scrollToBottom('auto');
						}
					},
					onAssistantReset: (_assistant, model) => {
						debouncedPersist(streamMessages);
						lastUsedModel = model;
					},
					onAssistantUpdated: () => debouncedPersist(streamMessages),
					onToolStatusUpdated: () => debouncedPersist(streamMessages),
					onToolResultsAdded: () => debouncedPersist(streamMessages),
					onMessageRemoved: () => debouncedPersist(streamMessages),
					onModelUpdate: (model) => (lastUsedModel = model)
				}
			});

			if (result.lastModel) {
				lastUsedModel = result.lastModel;
			}
			if (result.error) {
				showError(result.error);
			}
		} catch (error) {
			if (!controller.signal.aborted) {
				showError(error instanceof Error ? error.message : 'Something went wrong.');
			}
		} finally {
			if (persistTimeout) {
				clearTimeout(persistTimeout);
				persistTimeout = null;
			}
			orchestrator?.rejectPendingApprovals(new Error('Tool approval cancelled'));
			isPreparingTools = false;
			isStreaming = false;
			abortController = null;
			saveMessages(streamMessages);
		}
	};
</script>

<div class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
	<div
		class="min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
		bind:this={scrollRef}
		onscroll={updateIsNearBottom}
	>
		{#if messages.length === 0}
			<div
				class="mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center gap-6 px-6 py-10 text-center"
			>
				<div
					class="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/60 bg-background text-sm font-semibold text-[#f7931a]"
				>
					BTC
				</div>
				<div class="space-y-2">
					<p class="text-xl font-semibold text-foreground">Ask the Bitcoin node anything</p>
					<p class="text-sm leading-6 text-muted-foreground">
						This chat is wired to a single ContextVM server over Nostr — no server discovery, no
						picking. The model calls its tools, you approve them.
					</p>
				</div>

				<div
					class="flex w-full max-w-md items-center gap-3 rounded-xl border border-border/60 bg-card/60 px-3.5 py-3 text-left"
				>
					<span
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
					>
						<ServerIcon class="h-4 w-4" />
					</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm font-medium">
							{CHAT_SERVER.label ?? chatMcpServer.serverName}
						</span>
						<span class="block truncate font-mono text-[10px] text-muted-foreground">
							{CHAT_SERVER.pubkey.slice(0, 16)}…
						</span>
					</span>
					{#if connection.loading}
						<LoaderCircleIcon class="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
					{:else if connection.connected}
						<PlugIcon class="h-4 w-4 shrink-0 text-emerald-500" />
					{:else}
						<Button variant="outline" size="sm" onclick={() => chatMcpServer.getClient()}>
							Retry
						</Button>
					{/if}
				</div>

				{#if connection.error}
					<p class="text-xs text-destructive">{connection.error}</p>
				{/if}
				{#if payingWithCashu && !canSend}
					<p class="text-xs text-muted-foreground">
						Routstr is paid per request with ecash.
						<button
							type="button"
							class="font-medium text-primary hover:underline"
							onclick={openTopUp}
						>
							Top up your wallet
						</button>
						to start chatting.
					</p>
				{:else if payingWithCashu}
					<p class="text-[11px] text-muted-foreground/70">
						Paying per request with ecash — replies arrive in one piece once generated.
					</p>
				{:else if !hasApiKey}
					<p class="text-xs text-muted-foreground">
						Add an API key under <span class="font-medium">Model</span> to start chatting.
					</p>
				{:else if autoModeEnabled}
					<p class="text-[11px] text-muted-foreground/70">
						Auto mode rotates OpenRouter's free models — expect variable quality.
					</p>
				{/if}
			</div>
		{:else}
			<div class="mx-auto w-full max-w-4xl space-y-4 px-4 py-6">
				{#each messages as message (message.id)}
					<ChatBubble
						{message}
						onApproveToolCall={approveToolCall}
						onRejectToolCall={rejectToolCall}
					/>
				{/each}
				{#if isPreparingTools}
					<div class="flex items-center gap-2 pl-10 text-[11px] text-muted-foreground">
						<LoaderCircleIcon class="h-3 w-3 animate-spin" />
						<span>Fetching tool capabilities...</span>
					</div>
				{/if}
			</div>
		{/if}
	</div>
	<div class="border-t border-border bg-background/80 px-4 py-4">
		<div class={cn('mx-auto max-w-4xl space-y-2', errorMessage || toolsWarning ? 'pb-2' : '')}>
			{#if errorMessage}
				<p
					class="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"
				>
					{errorMessage}
					{#if needsTopUp}
						<button type="button" class="ml-1 font-medium underline" onclick={openTopUp}>
							Top up
						</button>
					{/if}
				</p>
			{/if}
			{#if toolsWarning}
				<p
					class="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
				>
					Could not reach {CHAT_SERVER.label} — this answer was written without its tools.
					<span class="text-amber-700/70 dark:text-amber-300/70">({toolsWarning})</span>
				</p>
			{/if}
			<ChatInput
				{isStreaming}
				disabled={!canSend}
				onSend={handleSend}
				onStop={handleStop}
				placeholder={inputPlaceholder}
			/>
		</div>
	</div>
</div>
