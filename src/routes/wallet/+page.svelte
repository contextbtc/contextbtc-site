<script lang="ts">
	import { onMount } from 'svelte';
	import SEO from '$lib/components/SEO.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import QrCode from '$lib/components/QrCode.svelte';
	import Loader from '@lucide/svelte/icons/loader-circle';
	import type { WalletWrapper } from '$lib/wasm/bdk/bdk';
	import {
		syncWallet,
		getBalanceSats,
		revealNextAddress,
		resetWallet,
		type SyncProgress,
		NETWORK,
		SERVER_PUBKEY,
		RELAYS
	} from '$lib/services/bdkWallet';

	let wallet = $state<WalletWrapper | null>(null);
	let balance = $state<bigint>(0n);
	let address = $state<string | null>(null);
	let status = $state<'syncing' | 'ready' | 'error'>('syncing');
	let error = $state<string | null>(null);
	let progress = $state<SyncProgress | null>(null);
	let caughtUp = $state(false);

	const balanceDisplay = $derived(balance.toLocaleString('en-US'));
	const progressPct = $derived(
		progress && progress.tip > progress.from
			? Math.min(
					100,
					Math.round(((progress.height - progress.from) / (progress.tip - progress.from)) * 100)
				)
			: 0
	);

	async function runSync() {
		status = 'syncing';
		error = null;
		try {
			const result = await syncWallet((p) => (progress = p));
			wallet = result.wallet;
			balance = getBalanceSats(result.wallet);
			caughtUp = result.caughtUp;
			status = 'ready';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			status = 'error';
		}
	}

	function onRevealAddress() {
		if (!wallet) return;
		address = revealNextAddress(wallet);
	}

	async function onReset() {
		resetWallet();
		wallet = null;
		balance = 0n;
		address = null;
		progress = null;
		caughtUp = false;
		await runSync();
	}

	onMount(runSync);
</script>

<SEO
	title="Wallet"
	description="An experimental Bitcoin wallet running in your browser, synced from bitcoind over ContextVM."
/>

<div class="container mx-auto max-w-3xl px-4 py-12 sm:py-16">
	<h1 class="mb-2 text-3xl font-bold tracking-tight sm:text-4xl">Wallet</h1>
	<p class="mb-8 text-muted-foreground">
		A Bitcoin Regtest wallet running in your browser, synced block-by-block from a
		<span class="font-medium">bitcoind</span> node over
		<a
			href="https://github.com/contextvm"
			target="_blank"
			rel="noopener noreferrer"
			class="underline underline-offset-4 hover:text-foreground">ContextVM</a
		>
		(Bitcoin RPC over Nostr). Watch-only demo on
		<span class="font-medium capitalize">{NETWORK}</span>.
	</p>

	{#if status === 'syncing'}
		<div class="rounded-lg border p-4">
			<div class="mb-3 flex items-center gap-2 text-muted-foreground">
				<Loader class="size-4 animate-spin" />
				<span>
					{#if progress}
						Syncing block {progress.height.toLocaleString('en-US')} / {progress.tip.toLocaleString(
							'en-US'
						)}
					{:else}
						Connecting to the RPC server over ContextVM…
					{/if}
				</span>
			</div>
			{#if progress}
				<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
					<div class="h-full bg-primary transition-all" style="width: {progressPct}%"></div>
				</div>
			{/if}
		</div>
	{:else if status === 'error'}
		<div class="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
			<p class="mb-3 text-sm break-words text-destructive">{error}</p>
			<Button variant="outline" size="sm" onclick={runSync}>Retry</Button>
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-4">
			<Card.Root>
				<Card.Header>
					<Card.Description>Balance</Card.Description>
					<Card.Title class="text-3xl font-bold tracking-tight">
						{balanceDisplay}
						<span class="text-base font-normal text-muted-foreground">sats</span>
					</Card.Title>
				</Card.Header>
			</Card.Root>

			{#if !caughtUp}
				<div
					class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4"
				>
					<p class="text-sm text-muted-foreground">
						Sync is not complete
						{#if progress}
							— reached block {progress.height.toLocaleString('en-US')} of {progress.tip.toLocaleString(
								'en-US'
							)}.
						{/if}
					</p>
					<Button size="sm" onclick={runSync}>Continue syncing</Button>
				</div>
			{/if}

			<Card.Root>
				<Card.Header>
					<Card.Title class="text-lg">Receive</Card.Title>
					<Card.Description>Reveal a fresh address to receive funds.</Card.Description>
				</Card.Header>
				<Card.Content>
					{#if address}
						<div class="flex flex-col items-center gap-4">
							{#key address}
								<QrCode data={address} size={180} />
							{/key}
							<code class="w-full rounded-md bg-muted p-3 text-center text-xs break-all">
								{address}
							</code>
						</div>
					{/if}
					<div class="mt-4 flex flex-wrap gap-2">
						<Button size="sm" onclick={onRevealAddress}>
							{address ? 'Reveal next address' : 'Reveal address'}
						</Button>
						<Button variant="outline" size="sm" onclick={onReset}>Reset & rescan</Button>
					</div>
				</Card.Content>
			</Card.Root>

			<p class="text-xs break-all text-muted-foreground">
				Server: <code>{SERVER_PUBKEY}</code> via <code>{RELAYS.join(', ')}</code>. Wallet state is
				cached in your browser's local storage.
			</p>
		</div>
	{/if}
</div>
