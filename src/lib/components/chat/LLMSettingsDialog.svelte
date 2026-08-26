<script lang="ts">
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { DEFAULT_LLM_CONFIG, PROVIDER_PRESETS, type LLMConfig } from '$lib/types/chat-types';
	import { LLMService, normalizeBaseURL } from '$lib/services/llm';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';

	let { config = $bindable() }: { config: LLMConfig } = $props();

	let open = $state(false);
	let draft = $state<LLMConfig>({ ...config });
	let models = $state<string[]>([]);
	let loadingModels = $state(false);
	let testState = $state<'idle' | 'testing' | 'ok' | 'error'>('idle');
	let testError = $state<string | null>(null);

	// Reset the draft each time the dialog opens so Cancel is a true no-op.
	$effect(() => {
		if (open) {
			draft = { ...config };
			models = [];
			testState = 'idle';
			testError = null;
		}
	});

	const selectProvider = (key: string) => {
		const preset = PROVIDER_PRESETS.find((candidate) => candidate.key === key);
		if (!preset) {
			return;
		}

		draft = { ...draft, provider: preset.key, baseURL: preset.baseURL || draft.baseURL };
		models = [];
	};

	const loadModels = async () => {
		loadingModels = true;
		testError = null;
		try {
			models = await new LLMService(draft).fetchModels();
		} catch (error) {
			testError = error instanceof Error ? error.message : 'Failed to list models.';
		} finally {
			loadingModels = false;
		}
	};

	const testConnection = async () => {
		testState = 'testing';
		testError = null;
		try {
			await new LLMService(draft).testConnection();
			testState = 'ok';
		} catch (error) {
			testState = 'error';
			testError = error instanceof Error ? error.message : 'Connection failed.';
		}
	};

	const save = () => {
		config = { ...draft, baseURL: normalizeBaseURL(draft.baseURL) };
		open = false;
	};

	const reset = () => {
		draft = { ...DEFAULT_LLM_CONFIG };
		models = [];
	};

	const isOpenRouter = $derived(draft.baseURL.toLowerCase().includes('openrouter.ai'));
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger
		class={buttonVariants({ variant: 'outline', size: 'sm' })}
		aria-label="Model settings"
	>
		<SettingsIcon class="h-4 w-4" />
		<span class="hidden sm:inline">Model</span>
	</Dialog.Trigger>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>LLM settings</Dialog.Title>
			<Dialog.Description>
				Bring your own OpenAI-compatible endpoint. The key is stored in this browser only and is
				sent straight to the provider you choose.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4">
			<div class="space-y-2">
				<Label>Provider</Label>
				<div class="flex flex-wrap gap-2">
					{#each PROVIDER_PRESETS as preset (preset.key)}
						<Button
							variant={draft.provider === preset.key ? 'default' : 'outline'}
							size="sm"
							onclick={() => selectProvider(preset.key)}
						>
							{preset.label}
						</Button>
					{/each}
				</div>
			</div>

			<div class="space-y-2">
				<Label for="llm-base-url">Base URL</Label>
				<Input id="llm-base-url" bind:value={draft.baseURL} placeholder="https://..." />
			</div>

			<div class="space-y-2">
				<Label for="llm-api-key">API key</Label>
				<Input
					id="llm-api-key"
					type="password"
					bind:value={draft.apiKey}
					placeholder="sk-..."
					autocomplete="off"
				/>
			</div>

			<div class="space-y-2">
				<div class="flex items-center justify-between">
					<Label for="llm-model">Model</Label>
					<Button variant="ghost" size="sm" onclick={loadModels} disabled={loadingModels}>
						{#if loadingModels}
							<LoaderCircleIcon class="h-3.5 w-3.5 animate-spin" />
						{/if}
						List models
					</Button>
				</div>
				<Input id="llm-model" bind:value={draft.model} list="llm-model-options" />
				<datalist id="llm-model-options">
					{#each models as model (model)}
						<option value={model}></option>
					{/each}
				</datalist>
				{#if isOpenRouter}
					<p class="text-xs text-muted-foreground">
						Use <code>auto</code> to rotate through OpenRouter's free (<code>:free</code>) models.
					</p>
				{/if}
			</div>

			{#if testError}
				<p
					class="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"
				>
					{testError}
				</p>
			{:else if testState === 'ok'}
				<p
					class="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400"
				>
					Connection works.
				</p>
			{/if}
		</div>

		<Dialog.Footer class="gap-2">
			<Button variant="ghost" size="sm" onclick={reset}>Reset</Button>
			<Button
				variant="outline"
				size="sm"
				onclick={testConnection}
				disabled={testState === 'testing'}
			>
				{#if testState === 'testing'}
					<LoaderCircleIcon class="h-3.5 w-3.5 animate-spin" />
				{/if}
				Test
			</Button>
			<Button size="sm" onclick={save}>Save</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
