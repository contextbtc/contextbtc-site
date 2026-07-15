<script lang="ts">
	import { asset, resolve } from '$app/paths';
	import SEO from '$lib/components/SEO.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import Zap from '@lucide/svelte/icons/zap';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Boxes from '@lucide/svelte/icons/boxes';

	const aboutHref = $derived<`/about`>('/about');
	const bitcoinLogoSrc = asset('/bitcoin_logo.svg');

	const features = [
		{
			icon: Zap,
			title: 'Lightning fast',
			description:
				'Lightning fast performance with a focus on minimalism and simplicity.'
		},
		{
			icon: ShieldCheck,
			title: 'Run your own node',
			description:
				'Run your own node with your own rules.'
		},
		{
			icon: Boxes,
			title: 'Build your own tools',
			description:
				'Build your own tools with your own rules.'
		}
	];
</script>

<SEO
	title="ContextBTC"
	description="Infrastructure tools for the Bitcoin ecosystem on top of ContextVM."
/>

<main class="relative overflow-x-hidden bg-background">
	<!-- Hero Section -->
	<section class="relative flex min-h-screen items-center justify-center">
		<!-- Subtle Background Gradients -->
		<div class="bg-gradients">
			<div class="bg-gradient bg-gradient-1"></div>
			<div class="bg-gradient bg-gradient-2"></div>
			<div class="bg-gradient bg-gradient-3"></div>
		</div>

		<!-- 3D Background Bitcoin Logos -->
		<div class="isometric-bg bg-mask" aria-hidden="true">
			<img src={bitcoinLogoSrc} alt="" class="isometric-square shape-btc" data-size="xl" />
			<img src={bitcoinLogoSrc} alt="" class="isometric-square shape-btc" data-size="sm" />
			<img src={bitcoinLogoSrc} alt="" class="isometric-square shape-btc" data-size="lg" />
			<img src={bitcoinLogoSrc} alt="" class="isometric-square shape-btc" data-size="xs" />

			<img src={bitcoinLogoSrc} alt="" class="isometric-square shape-btc" data-size="md" />
			<img src={bitcoinLogoSrc} alt="" class="isometric-square shape-btc" data-size="xs" />
			<img src={bitcoinLogoSrc} alt="" class="isometric-square shape-btc" data-size="sm" />

			<img src={bitcoinLogoSrc} alt="" class="isometric-square shape-btc" data-size="lg" />
			<img src={bitcoinLogoSrc} alt="" class="isometric-square shape-btc" data-size="xs" />
			<img src={bitcoinLogoSrc} alt="" class="isometric-square shape-btc" data-size="xl" />

			<img src={bitcoinLogoSrc} alt="" class="isometric-square shape-btc" data-size="xl" />
			<img src={bitcoinLogoSrc} alt="" class="isometric-square shape-btc" data-size="md" />
			<img src={bitcoinLogoSrc} alt="" class="isometric-square shape-btc" data-size="sm" />
		</div>

		<div class="animate-fade-in-up z-10 mx-auto max-w-4xl px-4 text-center sm:px-0">

			<h1 class="mb-4 text-4xl font-bold tracking-tight sm:mb-6 sm:text-5xl lg:text-7xl">
				Context<span class="text-[#f7931a]">BTC</span>
			</h1>

			<p
				class="mx-auto mb-6 max-w-2xl px-4 text-base leading-relaxed text-muted-foreground sm:mb-8 sm:px-0 sm:text-lg"
			>
				Infrastructure tools for the Bitcoin ecosystem on top of <a href="https://github.com/contextvm" target="_blank" rel="noopener noreferrer" class="text-muted-foreground transition-colors hover:text-foreground">ContextVM</a>.
			</p>

			<p class="mx-auto mb-6 max-w-2xl px-4 text-lg font-semibold text-foreground sm:mb-8 sm:px-0">
				Your node, your rules.
			</p>

			<div
				class="flex w-full flex-col items-center justify-center gap-3 px-4 sm:flex-row sm:gap-4 sm:px-0"
			>
				<Button
					size="lg"
					class="w-full px-6 text-base transition-transform duration-200 hover:scale-105 sm:w-auto sm:px-8"
					href="https://github.com/karliatto/contextbtc"
					target="_blank"
				>
					Get involved
				</Button>
				<Button
					size="lg"
					variant="outline"
					class="w-full px-6 text-base transition-transform duration-200 hover:scale-105 sm:w-auto sm:px-8"
					href={resolve(aboutHref)}
				>
					Learn more
				</Button>
			</div>
		</div>
	</section>

	<!-- Features Section -->
	<section class="border-t py-12 sm:py-16">
		<div class="container mx-auto px-4">
			<div class="mx-auto max-w-6xl">
				<div class="mb-8 text-center sm:mb-12">
					<h2
						class="mb-3 px-4 text-2xl font-bold tracking-tight sm:mb-4 sm:px-0 sm:text-3xl lg:text-4xl"
					>
						Everything you need to start
					</h2>
					<p class="px-4 text-base text-muted-foreground sm:px-0 sm:text-lg">
						A batteries-included foundation with sensible defaults.
					</p>
				</div>

				<div class="grid grid-cols-1 gap-6 md:grid-cols-3">
					{#each features as feature (feature.title)}
						{@const Icon = feature.icon}
						<Card.Root>
							<Card.Header>
								<div
									class="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"
								>
									<Icon class="size-5" />
								</div>
								<Card.Title>{feature.title}</Card.Title>
								<Card.Description>{feature.description}</Card.Description>
							</Card.Header>
						</Card.Root>
					{/each}
				</div>
			</div>
		</div>
	</section>
</main>
