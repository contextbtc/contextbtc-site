<script lang="ts">
	import SEO from '$lib/components/SEO.svelte';
	import ToolCategorySection from '$lib/components/tools/ToolCategorySection.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { toolCategories } from '$lib/services/tool-catalog';
	import SearchIcon from '@lucide/svelte/icons/search';

	let query = $state('');
</script>

<SEO
	title="Tools"
	description="Run the ContextBTC tools directly: Bitcoin node and electrs over ContextVM, hal and BDK in your browser."
/>

<div class="container mx-auto max-w-3xl px-4 py-12 sm:py-16">
	<h1 class="mb-2 text-3xl font-bold tracking-tight sm:text-4xl">Tools</h1>
	<p class="mb-6 text-muted-foreground">
		Every tool the chat can use, as a form. Node and electrs tools run on the ContextBTC servers
		over Nostr; hal and BDK tools run locally in your browser.
	</p>

	<div class="sticky top-14 z-10 -mx-4 mb-8 space-y-3 bg-background/95 px-4 py-3 backdrop-blur">
		<div class="relative">
			<SearchIcon
				class="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input class="pl-8" placeholder="Search tools…" bind:value={query} />
		</div>
		<nav class="flex flex-wrap gap-2" aria-label="Tool categories">
			{#each toolCategories as category (category.id)}
				<a
					href="#{category.id}"
					class="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
				>
					{category.label}
				</a>
			{/each}
		</nav>
	</div>

	<div class="space-y-12">
		{#each toolCategories as category (category.id)}
			<ToolCategorySection {category} {query} />
		{/each}
	</div>
</div>
