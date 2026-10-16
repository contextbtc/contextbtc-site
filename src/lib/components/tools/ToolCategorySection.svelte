<script lang="ts">
	import type { Tool } from '@contextvm/mcp-sdk/types.js';
	import type { ToolCategory } from '$lib/services/tool-catalog';
	import { McpServerToolSource } from '$lib/services/chatMcpServer.svelte';
	import { sanitizeFunctionName, ToolRegistry } from '$lib/services/mcp-openai-bridge';
	import { Button } from '$lib/components/ui/button/index.js';
	import ToolForm from './ToolForm.svelte';
	import { onMount } from 'svelte';
	import PlugIcon from '@lucide/svelte/icons/plug';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';

	let { category, query = '' }: { category: ToolCategory; query?: string } = $props();

	let tools = $state<Tool[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	// Validates arguments exactly as the chat does before calling a tool.
	let registry = new ToolRegistry();

	const remote = $derived(category.source instanceof McpServerToolSource ? category.source : null);

	const visibleTools = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return tools;
		return tools.filter((tool) =>
			[tool.name, tool.title, tool.description].some((text) => text?.toLowerCase().includes(needle))
		);
	});

	async function load() {
		const source = category.source;
		if (!source) return;

		loading = true;
		error = null;
		try {
			const listed = await source.listAllTools();
			registry = new ToolRegistry();
			registry.register(category.label, listed);
			tools = [...listed].sort((a, b) => a.name.localeCompare(b.name));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to list tools';
		} finally {
			loading = false;
		}
	}

	function validate(toolName: string, args: Record<string, unknown>): string | null {
		const resolved = registry.resolve(sanitizeFunctionName(toolName), JSON.stringify(args));
		return resolved.ok ? null : resolved.error;
	}

	onMount(() => {
		void load();
	});
</script>

<section id={category.id} class="scroll-mt-20 space-y-3">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div class="flex items-center gap-2">
			<h2 class="text-xl font-semibold tracking-tight">{category.label}</h2>
			{#if tools.length > 0}
				<span class="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
					{query.trim() ? `${visibleTools.length}/${tools.length}` : tools.length}
				</span>
			{/if}
		</div>
		{#if remote}
			<span
				class="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs {remote.state
					.connected
					? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
					: 'border-border bg-background/70 text-muted-foreground'}"
			>
				<PlugIcon class="h-3 w-3" />
				{remote.state.connected ? 'Connected' : remote.state.loading ? 'Connecting…' : 'Offline'}
			</span>
		{/if}
	</div>
	<p class="text-sm text-muted-foreground">{category.description}</p>

	{#if !category.source}
		<p
			class="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground"
		>
			{category.unavailable ?? 'Not available.'}
		</p>
	{:else if loading}
		<p class="flex items-center gap-2 text-sm text-muted-foreground">
			<LoaderCircleIcon class="h-4 w-4 animate-spin" />
			Loading tools…
		</p>
	{:else if error}
		<div
			class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3"
		>
			<p class="text-sm text-destructive">{error}</p>
			<Button variant="outline" size="sm" onclick={load}>Retry</Button>
		</div>
	{:else if visibleTools.length === 0}
		<p class="text-sm text-muted-foreground">
			{query.trim() ? 'No tools match your search.' : 'This source exposes no tools.'}
		</p>
	{:else}
		<div class="space-y-2">
			{#each visibleTools as tool (tool.name)}
				<ToolForm {tool} source={category.source} {validate} />
			{/each}
		</div>
	{/if}
</section>
