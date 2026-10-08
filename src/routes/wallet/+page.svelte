<script lang="ts">
	import { onMount } from 'svelte';
	import SEO from '$lib/components/SEO.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import QrCode from '$lib/components/QrCode.svelte';
	import Loader from '@lucide/svelte/icons/loader-circle';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import type { WalletWrapper } from '$lib/wasm/bdk/bdk';
	import {
		getBalanceSats,
		revealNextAddress,
		resetWallet,
		NETWORK,
		RELAYS
	} from '$lib/services/bdkWallet';
	import {
		SYNC_BACKENDS,
		DEFAULT_BACKEND,
		type SyncBackend,
		type SyncProgress
	} from '$lib/services/walletSync';

	const BACKEND_STORAGE_KEY = 'wallet:syncBackend';

	let backend = $state<SyncBackend>(DEFAULT_BACKEND);
	let wallet = $state<WalletWrapper | null>(null);
	let balance = $state<bigint>(0n);
	let address = $state<string | null>(null);
	let status = $state<'syncing' | 'ready' | 'error'>('syncing');
	let error = $state<string | null>(null);
	let progress = $state<SyncProgress | null>(null);
	let caughtUp = $state(false);

	const balanceDisplay = $derived(balance.toLocaleString('en-US'));
	const progressPct = $derived(
		progress && progress.total > 0
			? Math.min(100, Math.round((progress.done / progress.total) * 100))
			: 0
	);

	// Backends share one persisted wallet, so only one sync may run at a time:
	// the backend selector is disabled while syncing.
	async function runSync() {
		status = 'syncing';
		error = null;
		progress = null;
		try {
			const result = await backend.sync((p) => (progress = p));
			wallet = result.wallet;
			balance = getBalanceSats(result.wallet);
			caughtUp = result.caughtUp;
			status = 'ready';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			status = 'error';
		}
	}

	async function selectBackend(next: SyncBackend) {
		if (next.id === backend.id || status === 'syncing') return;
		backend = next;
		try {
			localStorage.setItem(BACKEND_STORAGE_KEY, next.id);
		} catch {
			// Storage unavailable: the choice just isn't remembered.
		}
		// Same wallet either way: just sync it with the newly selected backend.
		await runSync();
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
		caughtUp = false;
		await runSync();
	}

	onMount(() => {
		try {
			const saved = localStorage.getItem(BACKEND_STORAGE_KEY);
			backend = SYNC_BACKENDS.find((b) => b.id === saved) ?? DEFAULT_BACKEND;
		} catch {
			// Storage unavailable: keep the default backend.
		}
		runSync();
	});
</script>

<SEO
	title="Wallet"
	description="An experimental Bitcoin wallet running in your browser, synced from bitcoind or electrs over ContextVM."
/>

<div class="container mx-auto max-w-3xl px-4 py-12 sm:py-16">
	<h1 class="mb-2 text-3xl font-bold tracking-tight sm:text-4xl">Wallet</h1>
	<p class="mb-6 text-muted-foreground">
		A Bitcoin wallet running in your browser, synced over
		<a
			href="https://github.com/contextvm"
			target="_blank"
			rel="noopener noreferrer"
			class="underline underline-offset-4 hover:text-foreground">ContextVM</a
		>. Watch-only demo on <span class="font-medium capitalize">{NETWORK}</span>.
	</p>

	<div class="mb-8">
		<div class="mb-2 flex flex-wrap gap-2" role="group" aria-label="Sync method">
			{#each SYNC_BACKENDS as option (option.id)}
				<Button
					size="sm"
					variant={option.id === backend.id ? 'default' : 'outline'}
					aria-pressed={option.id === backend.id}
					disabled={status === 'syncing'}
					onclick={() => selectBackend(option)}
				>
					{option.label}
				</Button>
			{/each}
		</div>
		<p class="text-sm text-muted-foreground">{backend.description}</p>
	</div>

	{#if status === 'syncing'}
		<div class="rounded-lg border p-4">
			<div class="mb-3 flex items-center gap-2 text-muted-foreground">
				<Loader class="size-4 animate-spin" />
				<span>
					{#if progress}
						{progress.label}
					{:else}
						Connecting to the {backend.label} server over ContextVM…
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
					<Card.Action>
						<!-- Syncs the stored wallet from its tip; nothing is cleared. -->
						<Button variant="outline" size="sm" onclick={runSync}>
							<RefreshCw class="size-4" />
							Sync
						</Button>
					</Card.Action>
				</Card.Header>
			</Card.Root>

			{#if !caughtUp}
				<div
					class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4"
				>
					<p class="text-sm text-muted-foreground">
						Sync is not complete{#if progress}&nbsp;({progressPct}%){/if}.
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
				{backend.label} server: <code>{backend.serverPubkey}</code> via
				<code>{RELAYS.join(', ')}</code>. Wallet state is cached in your browser's local storage.
			</p>
		</div>
	{/if}
</div>
