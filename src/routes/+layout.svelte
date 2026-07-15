<script lang="ts">
	import Header from '$lib/components/header.svelte';
	import Footer from '$lib/components/footer.svelte';
	import { ModeWatcher } from 'mode-watcher';
	import '../app.css';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import { QueryClientProvider } from '@tanstack/svelte-query';
	import { queryClient } from '$lib/query-client';

	let { children } = $props();
</script>

<QueryClientProvider client={queryClient}>
	<ModeWatcher />
	<Header />
	<Toaster />
	<div class="min-h-screen pt-14">
		{@render children()}
	</div>
	<Footer />
</QueryClientProvider>
