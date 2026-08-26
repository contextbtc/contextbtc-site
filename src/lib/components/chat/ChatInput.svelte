<script lang="ts">
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import SquareIcon from '@lucide/svelte/icons/square';

	let {
		value = $bindable(''),
		isStreaming = false,
		disabled = false,
		onSend,
		onStop,
		placeholder = 'Ask about the Bitcoin node...',
		class: className
	}: {
		value?: string;
		isStreaming?: boolean;
		disabled?: boolean;
		onSend?: (value: string) => void;
		onStop?: () => void;
		placeholder?: string;
		class?: string;
	} = $props();

	let textareaRef = $state<HTMLTextAreaElement | null>(null);
	const isSendDisabled = $derived(!isStreaming && (disabled || value.trim().length === 0));

	const resize = () => {
		if (!textareaRef) {
			return;
		}

		textareaRef.style.height = 'auto';
		textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 180)}px`;
	};

	const handleSend = () => {
		const trimmed = value.trim();
		if (!trimmed || isStreaming || disabled) {
			return;
		}

		onSend?.(trimmed);
		value = '';
		resize();
		textareaRef?.focus();
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			handleSend();
		}
	};

	$effect(() => {
		if (typeof value === 'string') {
			resize();
		}
	});
</script>

<div class={cn('space-y-1', className)}>
	<div
		class="flex items-end gap-2 rounded-2xl border border-border bg-background/90 p-2 shadow-sm backdrop-blur transition-all focus-within:border-primary/60 focus-within:shadow-lg focus-within:ring-2 focus-within:ring-primary/15 hover:border-primary/40 hover:shadow-md"
	>
		<Textarea
			bind:ref={textareaRef}
			bind:value
			rows={1}
			class="min-h-[44px] w-full resize-none border-none bg-transparent text-sm shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0"
			{placeholder}
			{disabled}
			onkeydown={handleKeydown}
			oninput={resize}
		/>
		<Button
			size="icon"
			variant={isStreaming ? 'secondary' : 'default'}
			class={cn('h-9 w-9 transition-all', isStreaming ? 'animate-pulse' : 'hover:scale-105')}
			disabled={isSendDisabled}
			onclick={() => (isStreaming ? onStop?.() : handleSend())}
		>
			{#if isStreaming}
				<SquareIcon class="h-4 w-4" />
				<span class="sr-only">Stop generating</span>
			{:else}
				<ArrowUpIcon class="h-4 w-4" />
				<span class="sr-only">Send message</span>
			{/if}
		</Button>
	</div>
	<div class="flex items-center justify-between px-1 text-[11px] text-muted-foreground">
		<span>Enter to send</span>
		<span>Shift+Enter for new line</span>
	</div>
</div>
