<script lang="ts">
	import type { CallToolResult, Tool } from '@contextvm/mcp-sdk/types.js';
	import type { ChatToolSource } from '$lib/services/agent-orchestrator';
	import {
		buildArgs,
		fieldsFromSchema,
		formatResult,
		initialValues,
		type FormValue
	} from '$lib/services/tool-form';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { untrack } from 'svelte';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import PlayIcon from '@lucide/svelte/icons/play';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';

	let {
		tool,
		source,
		validate
	}: {
		tool: Tool;
		source: ChatToolSource;
		/** Schema-validates the arguments; returns an error message, or null when valid. */
		validate: (toolName: string, args: Record<string, unknown>) => string | null;
	} = $props();

	const fields = $derived(fieldsFromSchema(tool.inputSchema));
	let values = $state<Record<string, FormValue>>(untrack(() => initialValues(fields)));

	let running = $state(false);
	let formError = $state<string | null>(null);
	let result = $state<CallToolResult | null>(null);
	let callError = $state<string | null>(null);
	let showRaw = $state(false);
	let copied = $state(false);

	const summary = $derived(tool.description?.split('\n')[0] ?? '');
	const output = $derived(
		callError ?? (result ? (showRaw ? JSON.stringify(result, null, 2) : formatResult(result)) : '')
	);
	const failed = $derived(callError !== null || result?.isError === true);

	const controlClass =
		'flex h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30';

	async function run(event: SubmitEvent) {
		event.preventDefault();
		formError = null;

		const built = buildArgs(fields, values);
		if (!built.ok) {
			formError = built.error;
			return;
		}
		const invalid = validate(tool.name, built.args);
		if (invalid) {
			formError = invalid;
			return;
		}

		running = true;
		result = null;
		callError = null;
		try {
			result = await source.callTool(tool.name, built.args);
		} catch (error) {
			callError = error instanceof Error ? error.message : String(error);
		} finally {
			running = false;
		}
	}

	async function copy() {
		try {
			await navigator.clipboard.writeText(output);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// Clipboard unavailable (e.g. insecure context): nothing to do.
		}
	}
</script>

<details class="group rounded-lg border border-border bg-card">
	<summary
		class="flex cursor-pointer list-none items-start gap-2 px-4 py-3 select-none [&::-webkit-details-marker]:hidden"
	>
		<ChevronRightIcon
			class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
		/>
		<div class="min-w-0">
			<div class="flex flex-wrap items-baseline gap-x-2">
				<code class="text-sm font-semibold">{tool.name}</code>
				{#if tool.title}
					<span class="text-xs text-muted-foreground">{tool.title}</span>
				{/if}
			</div>
			{#if summary}
				<p class="mt-0.5 line-clamp-2 text-xs text-muted-foreground group-open:hidden">{summary}</p>
			{/if}
		</div>
	</summary>

	<form class="space-y-4 border-t border-border px-4 py-4" onsubmit={run}>
		{#if tool.description}
			<p class="text-sm whitespace-pre-line text-muted-foreground">{tool.description}</p>
		{/if}

		{#each fields as field (field.name)}
			{@const id = `${tool.name}-${field.name}`}
			<div class="space-y-1.5">
				{#if field.kind === 'checkbox'}
					<label class="flex items-center gap-2 text-sm font-medium">
						<input
							{id}
							type="checkbox"
							class="accent-primary"
							bind:checked={values[field.name] as boolean}
						/>
						{field.label}
					</label>
				{:else}
					<Label for={id}>
						{field.label}
						{#if field.required}<span class="text-destructive">*</span>{/if}
					</Label>
					{#if field.kind === 'select'}
						<select {id} class={controlClass} bind:value={values[field.name]}>
							{#if !field.required}
								<option value="">(default)</option>
							{/if}
							{#each field.options ?? [] as option (JSON.stringify(option))}
								<option value={JSON.stringify(option)}>{String(option)}</option>
							{/each}
						</select>
					{:else if field.kind === 'number'}
						<Input
							{id}
							type="number"
							min={field.min}
							max={field.max}
							step={field.integer ? 1 : 'any'}
							bind:value={values[field.name]}
						/>
					{:else if field.kind === 'text'}
						<Input {id} spellcheck="false" bind:value={values[field.name]} />
					{:else}
						<Textarea
							{id}
							rows={field.kind === 'json' ? 4 : 2}
							spellcheck="false"
							class="font-mono text-xs"
							placeholder={field.kind === 'json' ? 'JSON value' : undefined}
							bind:value={values[field.name] as string}
						/>
					{/if}
				{/if}
				{#if field.description}
					<p class="text-xs text-muted-foreground">{field.description}</p>
				{/if}
			</div>
		{:else}
			<p class="text-xs text-muted-foreground">This tool takes no arguments.</p>
		{/each}

		{#if formError}
			<p class="text-sm text-destructive">{formError}</p>
		{/if}

		<Button type="submit" size="sm" disabled={running}>
			{#if running}
				<LoaderCircleIcon class="h-4 w-4 animate-spin" />
				Running…
			{:else}
				<PlayIcon class="h-4 w-4" />
				Run
			{/if}
		</Button>

		{#if output}
			<div
				class="rounded-md border {failed
					? 'border-destructive/40 bg-destructive/5'
					: 'border-border bg-muted/40'}"
			>
				<div class="flex items-center justify-between gap-2 border-b border-inherit px-3 py-1.5">
					<span class="text-xs font-medium {failed ? 'text-destructive' : 'text-muted-foreground'}">
						{failed ? 'Error' : 'Result'}
					</span>
					<div class="flex items-center gap-3">
						{#if result}
							<label class="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
								<input type="checkbox" class="accent-primary" bind:checked={showRaw} />
								Raw MCP result
							</label>
						{/if}
						<button
							type="button"
							class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
							onclick={copy}
						>
							{#if copied}
								<CheckIcon class="h-3.5 w-3.5" /> Copied
							{:else}
								<CopyIcon class="h-3.5 w-3.5" /> Copy
							{/if}
						</button>
					</div>
				</div>
				<pre
					class="max-h-96 overflow-auto px-3 py-2 text-xs break-all whitespace-pre-wrap {failed
						? 'text-destructive'
						: ''}">{output}</pre>
			</div>
		{/if}
	</form>
</details>
