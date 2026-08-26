<script lang="ts" module>
	import { marked } from 'marked';

	const escapeHtml = (value: string) =>
		value
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');

	const renderer = new marked.Renderer();
	const codeClass =
		'relative overflow-x-auto rounded-lg border border-border/60 bg-muted/60 p-3 text-sm';
	const buttonClass =
		'code-copy absolute right-2 top-2 rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-foreground group-hover:opacity-100';

	renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
		const langClass = lang ? `language-${lang}` : '';
		const label = lang ? `Copy ${lang}` : 'Copy';
		const escaped = escapeHtml(text);
		return `
<div class="code-block group relative my-3 rounded-lg bg-muted/60" style="width:100%;min-width:0;max-width:100%">
	<button type="button" class="${buttonClass} z-10" aria-label="${label}">Copy</button>
	<div class="overflow-x-auto rounded-lg" style="width:0;min-width:100%">
		<pre class="${codeClass} m-0" style="min-width:0"><code class="${langClass}">${escaped}</code></pre>
	</div>
</div>
`;
	};

	const parseOptions = {
		async: false,
		breaks: true,
		gfm: true,
		renderer
	} as const;
</script>

<script lang="ts">
	import { browser } from '$app/environment';
	import DOMPurify from 'dompurify';
	import type { ChatMessage } from '$lib/types/chat-types';
	import ToolCallCard from '$lib/components/chat/ToolCallCard.svelte';
	import { cn, copyToClipboard, formatRelativeTime } from '$lib/utils.js';

	let {
		message,
		onApproveToolCall,
		onRejectToolCall
	}: {
		message: ChatMessage;
		onApproveToolCall?: (toolCallId: string) => void;
		onRejectToolCall?: (toolCallId: string) => void;
	} = $props();

	const html = $derived.by(() => {
		const raw = marked.parse(message.content ?? '', parseOptions) as string;
		return browser ? DOMPurify.sanitize(raw) : '';
	});

	const timestampLabel = $derived.by(() => formatRelativeTime(message.timestamp));

	const handleCodeCopy = async (event: MouseEvent) => {
		const target = event.target as HTMLElement | null;
		const button = target?.closest('.code-copy');
		if (!button) {
			return;
		}

		const code = button.closest('.code-block')?.querySelector('code')?.textContent ?? '';
		if (!code) {
			return;
		}

		await copyToClipboard(code);
	};
</script>

{#if message.role === 'tool'}
	<div class="flex w-full min-w-0 justify-start pl-10">
		<span
			class="rounded-full border border-border/60 bg-muted/60 px-2 py-1 text-[10px] text-muted-foreground/70"
		>
			Tool result for {message.toolName ?? 'unknown'} received
		</span>
	</div>
{:else}
	<div
		class={cn(
			'flex w-full min-w-0 gap-2',
			message.role === 'user' ? 'justify-end' : 'justify-start'
		)}
	>
		{#if message.role !== 'user'}
			<div
				class="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-gradient-to-br from-[#f7931a]/25 via-background to-background text-[10px] font-semibold text-[#f7931a]"
			>
				BTC
			</div>
		{/if}
		<div
			class={cn(
				'flex max-w-[90%] min-w-0 flex-1 flex-col overflow-hidden md:max-w-2xl lg:max-w-3xl',
				message.role === 'user' ? 'items-end' : 'items-start'
			)}
		>
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div
				class={cn(
					'relative w-full rounded-2xl px-4 py-3 text-sm leading-relaxed break-words shadow-sm',
					message.role === 'user'
						? 'bg-gradient-to-br from-primary to-primary/85 text-primary-foreground shadow-md shadow-primary/10'
						: message.role === 'system'
							? 'bg-muted text-muted-foreground'
							: 'border border-border/60 bg-card/80 text-card-foreground backdrop-blur-sm',
					message.role !== 'user' ? 'prose prose-sm dark:prose-invert max-w-none' : ''
				)}
				onclick={handleCodeCopy}
			>
				{#if message.role === 'user'}
					<p class="whitespace-pre-wrap">{message.content}</p>
				{:else if message.role === 'assistant' && message.toolCalls?.length}
					<div class="space-y-3">
						{#if message.content}
							<div>
								<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized through DOMPurify before rendering -->
								{@html html}
							</div>
						{/if}
						<div class="not-prose space-y-2">
							{#each message.toolCalls as toolCall (toolCall.id)}
								<ToolCallCard
									{toolCall}
									onApprove={() => onApproveToolCall?.(toolCall.id)}
									onReject={() => onRejectToolCall?.(toolCall.id)}
								/>
							{/each}
						</div>
					</div>
				{:else if message.role === 'assistant' && !message.content}
					<span class="flex h-5 items-center gap-1.5" aria-label="Assistant is responding">
						<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/70"></span>
						<span
							class="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/60 [animation-delay:120ms]"
						></span>
						<span
							class="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/50 [animation-delay:240ms]"
						></span>
					</span>
				{:else}
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized through DOMPurify before rendering -->
					{@html html}
				{/if}
			</div>
			{#if timestampLabel}
				<span class="mt-1 text-[10px] text-muted-foreground/50">{timestampLabel}</span>
			{/if}
		</div>
	</div>
{/if}
