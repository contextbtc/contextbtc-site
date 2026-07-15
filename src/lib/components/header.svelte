<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import Github from '@lucide/svelte/icons/github';
	import Menu from '@lucide/svelte/icons/menu';
	import X from '@lucide/svelte/icons/x';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import ThemeToggle from './theme-toggle.svelte';
	import AccountLoginDialog from './AccountLoginDialog.svelte';
	import ProfileCard from './ProfileCard.svelte';
	import { activeAccount } from '$lib/services/accountManager.svelte';

	const homeHref = $derived<`/`>('/');
	const aboutHref = $derived<`/about`>('/about');
	const interfacesHref = $derived<`/interfaces`>('/interfaces');

	let isMenuOpen = $state(false);
</script>

<header
	class="fixed top-0 right-0 left-0 z-50 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60"
>
	<div class="flex h-14 items-center justify-between px-4 py-4 sm:px-6">
		<!-- Logo -->
		<a
			href={resolve(homeHref)}
			class="flex items-center transition-transform duration-200 hover:scale-105"
		>
			<span class="text-xl font-bold tracking-tight sm:text-2xl">
				Context<span class="text-[#f7931a]">BTC</span>
			</span>
		</a>

		<!-- Desktop Navigation -->
		<div class="hidden items-center space-x-4 sm:flex sm:space-x-6">
			<nav class="flex items-center space-x-4 text-sm font-medium sm:space-x-6">
				<a
					href={resolve(interfacesHref)}
					class="transition-colors {$page.url.pathname.startsWith(resolve(interfacesHref))
						? 'font-semibold text-primary'
						: 'text-foreground/60 hover:text-primary'}"
				>
					Interfaces
				</a>
				<a
					href={resolve(aboutHref)}
					class="transition-colors {$page.url.pathname.startsWith(resolve(aboutHref))
						? 'font-semibold text-primary'
						: 'text-foreground/60 hover:text-primary'}"
				>
					About
				</a>
				<a
					href="https://github.com/karliatto/contextbtc"
					target="_blank"
					rel="noopener noreferrer"
					class="text-foreground/60 transition-colors hover:text-primary"
					aria-label="GitHub"
				>
					<Github class="h-4 w-4" />
			</a>
		</nav>
			<div class="flex items-center gap-2 sm:gap-4">
				{#if $activeAccount}
					<div class="hidden items-center gap-2 sm:flex sm:gap-3">
						<ProfileCard pubkey={$activeAccount.pubkey} mode="compact" showLogout={true} />
					</div>
				{:else}
					<div class="hidden sm:block">
						<AccountLoginDialog />
					</div>
				{/if}
			</div>
			<div class="flex items-center space-x-2">
				<ThemeToggle />
			</div>
		</div>

		<!-- Mobile Menu Button -->
		<div class="flex items-center space-x-2 sm:hidden">
			<ThemeToggle />
			<button
				onclick={() => (isMenuOpen = !isMenuOpen)}
				class="inline-flex size-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
				aria-label="Menu"
				aria-expanded={isMenuOpen}
			>
				{#if isMenuOpen}
					<X class="h-5 w-5" />
				{:else}
					<Menu class="h-5 w-5" />
				{/if}
			</button>
		</div>
	</div>

	<!-- Mobile Navigation -->
	{#if isMenuOpen}
		<div class="border-t bg-background/95 backdrop-blur sm:hidden">
			<nav class="flex flex-col space-y-1 px-4 py-4">
				<a
					href={resolve(interfacesHref)}
					class="transition-colors {$page.url.pathname.startsWith(resolve(interfacesHref))
						? 'font-semibold text-primary'
						: 'text-foreground/60 hover:text-primary'}"
				>
					Interfaces
				</a>
				<a
					href={resolve(aboutHref)}
					onclick={() => (isMenuOpen = false)}
					class="rounded-md px-4 py-3 text-base font-medium transition-colors {$page.url.pathname.startsWith(
						resolve(aboutHref)
					)
						? 'bg-primary/10 text-primary'
						: 'text-foreground/80 hover:bg-accent hover:text-foreground'}"
				>
					About
				</a>
				<a
					href="https://github.com/karliatto/contextbtc"
					target="_blank"
					rel="noopener noreferrer"
					onclick={() => (isMenuOpen = false)}
					class="flex items-center gap-2 rounded-md px-4 py-3 text-base font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
				>
					Docs
					<ExternalLink class="h-3 w-3 text-muted-foreground" />
				</a>
				<a
					href="https://github.com/karliatto/contextbtc"
					target="_blank"
					rel="noopener noreferrer"
					onclick={() => (isMenuOpen = false)}
					class="flex items-center gap-2 rounded-md px-4 py-3 text-base font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
					aria-label="GitHub"
				>
					<Github class="h-4 w-4" />
					GitHub
				</a>
			</nav>
			<div class="mt-6 border-t px-4 pt-6">
				{#if $activeAccount}
					<ProfileCard pubkey={$activeAccount.pubkey} mode="compact" showLogout={true} />
				{:else}
					<AccountLoginDialog />
				{/if}
			</div>
		</div>
	{/if}
</header>
