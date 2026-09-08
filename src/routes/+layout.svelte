<script lang="ts">
	import Header from '$lib/components/header.svelte';
	import Footer from '$lib/components/footer.svelte';
	import { ModeWatcher } from 'mode-watcher';
	import '../app.css';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import { QueryClientProvider } from '@tanstack/svelte-query';
	import { queryClient } from '$lib/query-client';
	import { page } from '$app/state';

	let { children } = $props();

	// Full-height app pages that manage their own viewport and have no room for a footer.
	const NO_FOOTER_ROUTES = ['/chat'];

	const showFooter = $derived(
		!NO_FOOTER_ROUTES.some(
			(route) => page.url.pathname === route || page.url.pathname.startsWith(`${route}/`)
		)
	);
</script>

<QueryClientProvider client={queryClient}>
	<ModeWatcher />
	<Header />
	<Toaster />
	<div class="min-h-screen pt-14">
		{@render children()}
	</div>
	{#if showFooter}
		<Footer />
	{/if}
</QueryClientProvider>
