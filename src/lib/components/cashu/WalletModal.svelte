<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import QrCode from '$lib/components/QrCode.svelte';
	import {
		cashuWallet,
		type PendingQuote,
		type WithdrawalQuote
	} from '$lib/services/cashu-wallet.svelte';
	import { DIALOG_IDS, dialogState } from '$lib/stores/dialog-state.svelte';
	import { cn } from '$lib/utils.js';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';

	const QUICK_AMOUNTS = [500, 1000, 5000];

	type Tab = 'topup' | 'withdraw';
	type WithdrawMethod = 'lightning' | 'token';

	let tab = $state<Tab>('topup');
	let amount = $state(QUICK_AMOUNTS[0]);
	let customAmount = $state('');
	let creating = $state(false);
	let error = $state<string | null>(null);
	let invoice = $state<PendingQuote | null>(null);
	let copied = $state<string | null>(null);
	let now = $state(Date.now());
	let pollController: AbortController | null = null;

	let withdrawMethod = $state<WithdrawMethod>('lightning');
	let invoiceToPay = $state('');
	let withdrawal = $state<WithdrawalQuote | null>(null);
	let busy = $state(false);
	let exportAmount = $state('');
	let exportedToken = $state<string | null>(null);

	const open = $derived(dialogState.dialogId === DIALOG_IDS.WALLET);
	const balance = $derived(cashuWallet.balance);
	const selectedAmount = $derived(customAmount ? Math.floor(Number(customAmount)) : amount);
	const validAmount = $derived(Number.isFinite(selectedAmount) && selectedAmount > 0);
	const exportSats = $derived(exportAmount ? Math.floor(Number(exportAmount)) : balance);
	const validExport = $derived(exportSats > 0 && exportSats <= balance);
	const secondsLeft = $derived(
		invoice?.expiry ? Math.max(0, Math.floor(invoice.expiry - now / 1000)) : null
	);
	const mintHost = $derived(new URL(cashuWallet.mintUrl).host);

	const setOpen = (next: boolean) => {
		if (next) {
			dialogState.dialogId = DIALOG_IDS.WALLET;
			return;
		}
		if (dialogState.dialogId === DIALOG_IDS.WALLET) {
			dialogState.dialogId = null;
		}
		cashuWallet.markTopupPromptSeen();
	};

	// Resume an unpaid invoice from a previous visit, and stop polling when closed.
	$effect(() => {
		if (!open) {
			stopPolling();
			return;
		}
		untrack(() => {
			error = null;
			const pending = cashuWallet.state.pendingQuote;
			if (pending) {
				tab = 'topup';
				invoice = pending;
				startPolling();
			}
		});
	});

	$effect(() => {
		if (!invoice?.expiry) {
			return;
		}
		const interval = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(interval);
	});

	const selectTab = (next: Tab) => {
		tab = next;
		error = null;
	};

	const stopPolling = () => {
		pollController?.abort();
		pollController = null;
	};

	const startPolling = () => {
		stopPolling();
		const controller = new AbortController();
		pollController = controller;
		cashuWallet
			.waitForInvoice(controller.signal)
			.then((received) => {
				toast.success(`Received ${received.toLocaleString()} sats`);
				invoice = null;
				setOpen(false);
			})
			.catch((reason: unknown) => {
				if (controller.signal.aborted) {
					return;
				}
				error = reason instanceof Error ? reason.message : 'Failed to check the invoice.';
				invoice = null;
			})
			.finally(() => {
				if (pollController === controller) {
					pollController = null;
				}
			});
	};

	const createInvoice = async () => {
		if (!validAmount) {
			return;
		}
		creating = true;
		error = null;
		try {
			invoice = await cashuWallet.createInvoice(selectedAmount);
			startPolling();
		} catch (reason) {
			error = reason instanceof Error ? reason.message : 'Failed to create an invoice.';
		} finally {
			creating = false;
		}
	};

	const newAmount = () => {
		stopPolling();
		cashuWallet.clearPendingQuote();
		invoice = null;
		error = null;
	};

	const quoteWithdrawal = async () => {
		if (!invoiceToPay.trim()) {
			return;
		}
		busy = true;
		error = null;
		try {
			withdrawal = await cashuWallet.quoteWithdrawal(invoiceToPay);
			if (withdrawal.total > balance) {
				error = `This invoice needs ${withdrawal.total.toLocaleString()} sats including fees, but the wallet holds ${balance.toLocaleString()}.`;
			}
		} catch (reason) {
			error = reason instanceof Error ? reason.message : 'Could not read that invoice.';
		} finally {
			busy = false;
		}
	};

	const payWithdrawal = async () => {
		if (!withdrawal) {
			return;
		}
		busy = true;
		error = null;
		try {
			const paid = await cashuWallet.payInvoice(withdrawal.id);
			toast.success(`Paid ${paid.toLocaleString()} sats`);
			withdrawal = null;
			invoiceToPay = '';
		} catch (reason) {
			error = reason instanceof Error ? reason.message : 'The payment failed.';
		} finally {
			busy = false;
		}
	};

	const exportToken = async () => {
		if (!validExport) {
			return;
		}
		busy = true;
		error = null;
		try {
			exportedToken = await cashuWallet.exportToken(exportSats);
		} catch (reason) {
			error = reason instanceof Error ? reason.message : 'Could not create the token.';
		} finally {
			busy = false;
		}
	};

	const copy = async (id: string, text: string) => {
		await navigator.clipboard.writeText(text);
		copied = id;
		setTimeout(() => {
			if (copied === id) {
				copied = null;
			}
		}, 1500);
	};

	const formatCountdown = (seconds: number) =>
		`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
</script>

{#snippet tabButton(id: Tab, label: string, disabled = false)}
	<button
		type="button"
		{disabled}
		onclick={() => selectTab(id)}
		class={cn(
			'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40',
			tab === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
		)}
	>
		{label}
	</button>
{/snippet}

<Dialog.Root bind:open={() => open, setOpen}>
	<Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<ZapIcon class="h-4 w-4 text-[#f7931a]" />
				Cashu wallet
			</Dialog.Title>
			<Dialog.Description>
				Sats here pay for Routstr completions, one token per request, with the unused part refunded
				automatically.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex gap-1 rounded-lg bg-muted p-1">
			{@render tabButton('topup', 'Top up')}
			{@render tabButton('withdraw', 'Withdraw', balance === 0)}
		</div>

		{#if tab === 'topup'}
			{#if invoice}
				<div class="flex flex-col items-center gap-3">
					<p class="text-sm">
						Pay <span class="font-semibold">{invoice.amount.toLocaleString()} sats</span> with any Lightning
						wallet
					</p>
					<a href="lightning:{invoice.request}" aria-label="Open in Lightning wallet">
						{#key invoice.request}
							<QrCode data={invoice.request} size={220} />
						{/key}
					</a>
					<div class="flex w-full flex-col items-stretch gap-2">
						<Textarea
							readonly
							rows={5}
							value={invoice.request}
							aria-label="Lightning invoice"
							class="resize-none bg-muted/40 font-mono text-xs break-all"
							onfocus={(event) => event.currentTarget.select()}
						/>
						<Button
							variant="outline"
							size="sm"
							class="self-center"
							onclick={() => copy('invoice', invoice?.request ?? '')}
						>
							{#if copied === 'invoice'}
								<CheckIcon class="h-4 w-4" />
							{:else}
								<CopyIcon class="h-4 w-4" />
							{/if}
							Copy
						</Button>
					</div>
					<p class="flex items-center gap-2 text-xs text-muted-foreground">
						<LoaderCircleIcon class="h-3 w-3 animate-spin" />
						Waiting for payment…
						{#if secondsLeft !== null}
							<span class="tabular-nums">expires in {formatCountdown(secondsLeft)}</span>
						{/if}
					</p>
					<Button variant="ghost" size="sm" onclick={newAmount}>New amount</Button>
				</div>
			{:else}
				<div class="space-y-3">
					<div class="grid grid-cols-3 gap-2">
						{#each QUICK_AMOUNTS as quick (quick)}
							<button
								type="button"
								onclick={() => {
									amount = quick;
									customAmount = '';
								}}
								class={cn(
									'rounded-md border px-3 py-2 text-sm font-medium transition-colors',
									!customAmount && amount === quick
										? 'border-primary bg-primary/10 text-primary'
										: 'border-border hover:bg-accent'
								)}
							>
								{quick.toLocaleString()} sats
							</button>
						{/each}
					</div>
					<Input
						type="number"
						min="1"
						inputmode="numeric"
						placeholder="Custom amount (sats)"
						bind:value={customAmount}
					/>
					<Button class="w-full" onclick={createInvoice} disabled={!validAmount || creating}>
						{#if creating}
							<LoaderCircleIcon class="h-4 w-4 animate-spin" />
						{:else}
							<ZapIcon class="h-4 w-4" />
						{/if}
						Get invoice{validAmount ? ` for ${selectedAmount.toLocaleString()} sats` : ''}
					</Button>
				</div>
			{/if}
		{:else}
			<div class="space-y-3">
				<div class="flex gap-2 text-xs">
					<button
						type="button"
						onclick={() => {
							withdrawMethod = 'lightning';
							error = null;
						}}
						class={cn(
							'rounded-md border px-2.5 py-1 transition-colors',
							withdrawMethod === 'lightning'
								? 'border-primary bg-primary/10 text-primary'
								: 'border-border text-muted-foreground hover:bg-accent'
						)}
					>
						Lightning invoice
					</button>
					<button
						type="button"
						onclick={() => {
							withdrawMethod = 'token';
							error = null;
						}}
						class={cn(
							'rounded-md border px-2.5 py-1 transition-colors',
							withdrawMethod === 'token'
								? 'border-primary bg-primary/10 text-primary'
								: 'border-border text-muted-foreground hover:bg-accent'
						)}
					>
						Ecash token
					</button>
				</div>

				{#if withdrawMethod === 'lightning'}
					<Textarea
						rows={4}
						bind:value={invoiceToPay}
						placeholder="Paste a Lightning invoice (lnbc…)"
						class="resize-none font-mono text-xs break-all"
						disabled={busy || withdrawal !== null}
					/>
					{#if withdrawal}
						<div class="space-y-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
							<p class="flex justify-between">
								<span class="text-muted-foreground">Invoice</span>
								<span class="font-medium tabular-nums"
									>{withdrawal.amount.toLocaleString()} sats</span
								>
							</p>
							<p class="flex justify-between">
								<span class="text-muted-foreground">Max routing fee</span>
								<span class="tabular-nums">{withdrawal.feeReserve.toLocaleString()} sats</span>
							</p>
							<p class="flex justify-between border-t border-border pt-1">
								<span class="text-muted-foreground">Reserved total</span>
								<span class="font-medium tabular-nums"
									>{withdrawal.total.toLocaleString()} sats</span
								>
							</p>
						</div>
						<div class="flex gap-2">
							<Button
								class="flex-1"
								onclick={payWithdrawal}
								disabled={busy || withdrawal.total > balance}
							>
								{#if busy}
									<LoaderCircleIcon class="h-4 w-4 animate-spin" />
								{/if}
								Pay {withdrawal.amount.toLocaleString()} sats
							</Button>
							<Button
								variant="ghost"
								onclick={() => {
									withdrawal = null;
									error = null;
								}}
								disabled={busy}
							>
								Cancel
							</Button>
						</div>
						<p class="text-[11px] text-muted-foreground">
							Unused routing fees come back to the wallet as change.
						</p>
					{:else}
						<Button
							class="w-full"
							onclick={quoteWithdrawal}
							disabled={busy || !invoiceToPay.trim()}
						>
							{#if busy}
								<LoaderCircleIcon class="h-4 w-4 animate-spin" />
							{/if}
							Check invoice
						</Button>
					{/if}
				{:else if exportedToken}
					<div class="space-y-2">
						<Textarea
							readonly
							rows={5}
							value={exportedToken}
							aria-label="Cashu token"
							class="resize-none bg-muted/40 font-mono text-xs break-all"
							onfocus={(event) => event.currentTarget.select()}
						/>
						<Button
							variant="outline"
							size="sm"
							class="w-full"
							onclick={() => copy('token', exportedToken ?? '')}
						>
							{#if copied === 'token'}
								<CheckIcon class="h-4 w-4" />
							{:else}
								<CopyIcon class="h-4 w-4" />
							{/if}
							Copy token
						</Button>
						<p
							class="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300"
						>
							These sats have already left this wallet. Copy the token now — closing this dialog
							without saving it loses them.
						</p>
						<Button
							variant="ghost"
							size="sm"
							class="w-full"
							onclick={() => {
								exportedToken = null;
								exportAmount = '';
							}}
						>
							Done
						</Button>
					</div>
				{:else}
					<Input
						type="number"
						min="1"
						max={balance}
						inputmode="numeric"
						placeholder={`Amount (default: all ${balance.toLocaleString()} sats)`}
						bind:value={exportAmount}
					/>
					<Button class="w-full" onclick={exportToken} disabled={busy || !validExport}>
						{#if busy}
							<LoaderCircleIcon class="h-4 w-4 animate-spin" />
						{/if}
						Create token for {exportSats.toLocaleString()} sats
					</Button>
					<p class="text-[11px] text-muted-foreground">
						Creates a cashu token you can paste into any wallet that accepts {mintHost}.
					</p>
				{/if}
			</div>
		{/if}

		{#if error}
			<p
				class="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"
			>
				{error}
			</p>
		{/if}

		<div class="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
			<p>
				Balance: <span class="font-medium text-foreground">{balance.toLocaleString()} sats</span>
				· Mint: {mintHost}
			</p>
			<p class="text-[11px] leading-4">
				Ecash is held by the mint and stored only in this browser. Clearing site data loses it —
				keep balances small.
			</p>
		</div>

		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => setOpen(false)}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
