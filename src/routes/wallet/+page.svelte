<script lang="ts">
	import { onMount } from 'svelte';
	import SEO from '$lib/components/SEO.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import QrCode from '$lib/components/QrCode.svelte';
	import Loader from '@lucide/svelte/icons/loader-circle';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import type { WalletWrapper } from '$lib/wasm/bdk/bdk';
	import {
		getBalanceSats,
		revealNextAddress,
		resetWallet,
		normalizeDescriptors,
		defaultDescriptors,
		defaultDescriptorsEnvVar,
		loadSelectedNetwork,
		saveSelectedNetwork,
		loadSelectedConfig,
		saveSelectedConfig,
		NETWORKS,
		DEFAULT_NETWORK,
		RELAYS,
		type Network,
		type WalletConfig
	} from '$lib/services/bdkWallet';
	import {
		SYNC_BACKENDS,
		DEFAULT_BACKEND,
		type SyncBackend,
		type SyncProgress
	} from '$lib/services/walletSync';

	const BACKEND_STORAGE_KEY = 'wallet:syncBackend';

	let backend = $state<SyncBackend>(DEFAULT_BACKEND);
	let network = $state<Network>(DEFAULT_NETWORK);
	/** The applied wallet: null until the network has a descriptor pair. */
	let config = $state<WalletConfig | null>(null);
	let externalInput = $state('');
	let internalInput = $state('');
	let startHeightInput = $state('0');
	let descriptorError = $state<string | null>(null);
	let applyingDescriptors = $state(false);
	let wallet = $state<WalletWrapper | null>(null);
	let balance = $state<bigint>(0n);
	let address = $state<string | null>(null);
	// 'idle': no wallet to sync yet (no descriptors for this network).
	let status = $state<'idle' | 'syncing' | 'ready' | 'error'>('idle');
	let error = $state<string | null>(null);
	let progress = $state<SyncProgress | null>(null);
	let caughtUp = $state(false);

	const networkLabel = $derived(NETWORKS.find((n) => n.id === network)?.label ?? network);
	const balanceDisplay = $derived(balance.toLocaleString('en-US'));
	const inputsEdited = $derived(
		externalInput.trim() !== (config?.external ?? '') ||
			internalInput.trim() !== (config?.internal ?? '') ||
			startHeightInput.trim() !== String(config?.startHeight ?? 0)
	);
	const progressPct = $derived(
		progress && progress.total > 0
			? Math.min(100, Math.round((progress.done / progress.total) * 100))
			: 0
	);

	// Backends share one persisted wallet, so only one sync may run at a time:
	// the backend, network and descriptor controls are disabled while syncing.
	async function runSync() {
		if (!config) return;
		status = 'syncing';
		error = null;
		progress = null;
		try {
			const result = await backend.sync(config, (p) => (progress = p));
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

	function clearWalletState() {
		wallet = null;
		balance = 0n;
		address = null;
		progress = null;
		caughtUp = false;
	}

	function fillInputs(c: Pick<WalletConfig, 'external' | 'internal'> | null, startHeight = 0) {
		externalInput = c?.external ?? '';
		internalInput = c?.internal ?? '';
		startHeightInput = String(startHeight);
	}

	/**
	 * Shows `next`'s wallet: the last one applied on it, else the build-time
	 * default pair, else nothing (the user has to enter descriptors).
	 */
	async function loadNetwork(next: Network) {
		network = next;
		clearWalletState();
		descriptorError = null;
		error = null;
		config = loadSelectedConfig(next);
		if (!config) {
			const defaults = defaultDescriptors(next);
			if (defaults) {
				try {
					const normalized = await normalizeDescriptors(next, defaults.external, defaults.internal);
					config = { network: next, ...normalized, startHeight: 0 };
				} catch (e) {
					fillInputs(defaults);
					descriptorError = `The default descriptors for ${networkLabel} are invalid: ${
						e instanceof Error ? e.message : String(e)
					}`;
				}
			}
		}
		if (config) {
			fillInputs(config, config.startHeight);
			await runSync();
		} else {
			if (!descriptorError) fillInputs(null);
			status = 'idle';
		}
	}

	async function selectNetwork(next: Network) {
		if (next === network || status === 'syncing' || applyingDescriptors) return;
		saveSelectedNetwork(next);
		await loadNetwork(next);
	}

	/**
	 * Validates the inputs and, if they name another wallet, switches to and
	 * syncs it. A new start height alone is just saved: it only applies to a
	 * fresh wallet (first sync, or after "Reset & rescan").
	 */
	async function applyDescriptors() {
		if (status === 'syncing') return;
		descriptorError = null;
		const startHeight = Number(startHeightInput.trim() || '0');
		if (!Number.isInteger(startHeight) || startHeight < 0) {
			descriptorError = 'Start height must be a whole number, 0 or more.';
			return;
		}
		applyingDescriptors = true;
		try {
			const normalized = await normalizeDescriptors(network, externalInput, internalInput);
			const next: WalletConfig = { network, ...normalized, startHeight };
			fillInputs(next, startHeight);
			const sameWallet = config?.external === next.external && config?.internal === next.internal;
			config = next;
			saveSelectedConfig(next);
			if (sameWallet) return;
			clearWalletState();
			await runSync();
		} catch (e) {
			descriptorError = e instanceof Error ? e.message : String(e);
		} finally {
			applyingDescriptors = false;
		}
	}

	function restoreDefaultDescriptors() {
		const defaults = defaultDescriptors(network);
		if (!defaults) {
			descriptorError = `No default descriptors for ${networkLabel}: set ${defaultDescriptorsEnvVar(network)} in .env.`;
			return;
		}
		fillInputs(defaults);
		applyDescriptors();
	}

	function onRevealAddress() {
		if (!wallet || !config) return;
		address = revealNextAddress(wallet, config);
	}

	async function onReset() {
		if (!config) return;
		resetWallet(config);
		clearWalletState();
		await runSync();
	}

	onMount(() => {
		try {
			const saved = localStorage.getItem(BACKEND_STORAGE_KEY);
			backend = SYNC_BACKENDS.find((b) => b.id === saved) ?? DEFAULT_BACKEND;
		} catch {
			// Storage unavailable: keep the default backend.
		}
		loadNetwork(loadSelectedNetwork());
	});
</script>

<SEO
	title="Wallet"
	description="An experimental Bitcoin wallet running in your browser, synced from bitcoind or electrs over ContextVM."
/>

<div class="container mx-auto max-w-3xl px-4 py-12 sm:py-16">
	<h1 class="mb-2 text-3xl font-bold tracking-tight sm:text-4xl">Wallet</h1>
	<p class="mb-6 text-muted-foreground">
		A Bitcoin watch-only wallet running in your browser, synced over
		<a
			href="https://github.com/contextvm"
			target="_blank"
			rel="noopener noreferrer"
			class="underline underline-offset-4 hover:text-foreground">ContextVM</a
		>.
	</p>

	<div class="mb-6">
		<div class="flex flex-wrap gap-2" role="group" aria-label="Network">
			{#each NETWORKS as option (option.id)}
				<Button
					size="sm"
					variant={option.id === network ? 'default' : 'outline'}
					aria-pressed={option.id === network}
					disabled={status === 'syncing' || applyingDescriptors}
					onclick={() => selectNetwork(option.id)}
				>
					{option.label}
				</Button>
			{/each}
		</div>
	</div>

	<Card.Root class="mb-6">
		<Card.Header>
			<Card.Title class="text-lg">Descriptors</Card.Title>
			<Card.Description>
				The {networkLabel} watch-only wallet to sync: public descriptors only. Each pair is kept as its
				own wallet in this browser.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-4">
			<div class="grid gap-2">
				<Label for="external-descriptor">External (receive)</Label>
				<Textarea
					id="external-descriptor"
					bind:value={externalInput}
					rows={3}
					spellcheck={false}
					class="font-mono text-xs break-all"
				/>
			</div>
			<div class="grid gap-2">
				<Label for="internal-descriptor">Internal (change)</Label>
				<Textarea
					id="internal-descriptor"
					bind:value={internalInput}
					rows={3}
					spellcheck={false}
					class="font-mono text-xs break-all"
				/>
			</div>
			<div class="grid gap-2">
				<Label for="start-height">Start height (wallet birthday)</Label>
				<Input
					id="start-height"
					inputmode="numeric"
					pattern="[0-9]*"
					bind:value={startHeightInput}
					class="max-w-48"
				/>
				<p class="text-xs text-muted-foreground">
					First block that can hold this wallet's transactions. Bitcoin RPC sync starts there on a
					fresh wallet (0 scans from genesis, which takes very long on mainnet); Electrum doesn't
					need it.
				</p>
			</div>
			{#if descriptorError}
				<p class="text-sm break-words text-destructive">{descriptorError}</p>
			{/if}
			<div class="flex flex-wrap gap-2">
				<Button
					size="sm"
					disabled={status === 'syncing' || applyingDescriptors || !inputsEdited}
					onclick={applyDescriptors}
				>
					Apply
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={status === 'syncing' || applyingDescriptors}
					onclick={restoreDefaultDescriptors}
				>
					Restore default
				</Button>
			</div>
		</Card.Content>
	</Card.Root>

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

	{#if status === 'idle'}
		<div class="rounded-lg border p-4 text-sm text-muted-foreground">
			Enter a {networkLabel} descriptor pair above and click Apply to load a wallet.
		</div>
	{:else if status === 'syncing'}
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
