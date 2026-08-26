<script lang="ts">
	import SEO from '$lib/components/SEO.svelte';
	import Chat from '$lib/components/chat/Chat.svelte';
	import LLMSettingsDialog from '$lib/components/chat/LLMSettingsDialog.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { CHAT_SERVER, chatMcpServer } from '$lib/services/chatMcpServer.svelte';
	import { loadLLMConfig, saveLLMConfig } from '$lib/services/chat-history';
	import { DEFAULT_LLM_CONFIG, type LLMConfig } from '$lib/types/chat-types';
	import { browser } from '$app/environment';
	import PlugIcon from '@lucide/svelte/icons/plug';
	import PlusIcon from '@lucide/svelte/icons/plus';

	const AUTO_APPROVE_KEY = 'contextbtc.chat.autoApproveTools';

	let config = $state<LLMConfig>(loadLLMConfig({ ...DEFAULT_LLM_CONFIG }));
	let lastUsedModel = $state('');
	let autoApproveTools = $state(browser && localStorage.getItem(AUTO_APPROVE_KEY) === '1');
	let chat = $state<ReturnType<typeof Chat> | null>(null);

	$effect(() => {
		saveLLMConfig(config);
	});

	$effect(() => {
		if (browser) {
			localStorage.setItem(AUTO_APPROVE_KEY, autoApproveTools ? '1' : '0');
		}
	});

	const modelLabel = $derived(
		config.model === 'auto' ? 'Auto free models' : config.model || 'No model'
	);
	const connection = $derived(chatMcpServer.state);
</script>

<SEO
	title="Chat"
	description="Chat with an LLM that can call the tools of the ContextBTC Bitcoin node over Nostr."
/>

<div class="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden">
	<div
		class="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background/80 px-4 py-3 backdrop-blur"
	>
		<div class="flex flex-col">
			<span class="text-sm font-semibold">Chat</span>
			<span class="text-xs text-muted-foreground">
				{chatMcpServer.serverName ?? CHAT_SERVER.label}
			</span>
		</div>

		<div class="flex min-w-0 flex-wrap items-center gap-2">
			<span
				class="hidden max-w-[14rem] truncate rounded-md border border-border bg-background/70 px-2 py-1 text-xs text-muted-foreground md:inline"
			>
				{modelLabel}
			</span>
			{#if lastUsedModel}
				<span
					class="hidden max-w-[14rem] truncate rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-xs text-primary md:inline"
				>
					Last used: {lastUsedModel}
				</span>
			{/if}
			<span
				class="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs {connection.connected
					? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
					: 'border-border bg-background/70 text-muted-foreground'}"
			>
				<PlugIcon class="h-3 w-3" />
				{connection.connected ? 'Connected' : connection.loading ? 'Connecting…' : 'Offline'}
			</span>

			<label class="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
				<input type="checkbox" class="accent-primary" bind:checked={autoApproveTools} />
				<span class="hidden sm:inline">Auto-approve</span>
			</label>

			<Button variant="outline" size="sm" onclick={() => chat?.newChat()}>
				<PlusIcon class="h-4 w-4" />
				<span class="hidden sm:inline">New chat</span>
			</Button>
			<LLMSettingsDialog bind:config />
		</div>
	</div>

	<div class="min-h-0 flex-1 overflow-hidden">
		<Chat bind:this={chat} {config} bind:lastUsedModel {autoApproveTools} />
	</div>
</div>
