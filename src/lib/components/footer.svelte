<script lang="ts">
	import { asset, resolve } from '$app/paths';
	import Github from '@lucide/svelte/icons/github';
	import Mail from '@lucide/svelte/icons/mail';
	const homeHref = $derived<`/`>('/');

	const aboutHref = $derived<`/about`>('/about');
	const logoBlackSrc = asset('/logo-black.svg');
	const logoWhiteSrc = asset('/logo-white.svg');
</script>

<footer class="border-t bg-muted/30">
	<div class="container mx-auto px-4 py-8 sm:py-12">
		<div class="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
			<!-- Brand Section -->
			<div class="space-y-4">
				<a
					href={resolve(homeHref)}
					class="flex items-center transition-transform duration-200 hover:scale-105"
				>
					<span class="text-xl font-bold tracking-tight sm:text-2xl">
						Context<span class="text-[#f7931a]">BTC</span>
					</span>
				</a>
				<p class="text-sm text-muted-foreground">
					A project with the goal of building infrastructure tools for the Bitcoin ecosystem on top
					of <a
						href="https://github.com/contextvm"
						target="_blank"
						rel="noopener noreferrer"
						class="text-muted-foreground transition-colors hover:text-foreground">ContextVM</a
					>.
				</p>
				<div class="flex items-center space-x-4">
					<a
						href="https://github.com/contextbtc"
						target="_blank"
						rel="noopener noreferrer"
						class="text-muted-foreground transition-colors hover:text-foreground"
						aria-label="GitHub"
					>
						<Github class="h-5 w-5" />
					</a>
					<a
						href="mailto:karliatto@protonmail.com"
						class="text-muted-foreground transition-colors hover:text-foreground"
						aria-label="Email"
					>
						<Mail class="h-5 w-5" />
					</a>
				</div>
			</div>

			<!-- Navigation Links -->
			<div class="space-y-4">
				<h3 class="text-sm font-semibold">Navigation</h3>
				<nav class="flex flex-col space-y-2">
					<a
						href={resolve(aboutHref)}
						class="text-sm text-muted-foreground transition-colors hover:text-foreground"
					>
						About
					</a>
				</nav>
			</div>

			<!-- Resources -->
			<div class="space-y-4">
				<h3 class="text-sm font-semibold">Resources</h3>
				<nav class="flex flex-col space-y-2">
					<a
						href="https://github.com/contextbtc"
						target="_blank"
						rel="noopener noreferrer"
						class="text-sm text-muted-foreground transition-colors hover:text-foreground"
					>
						GitHub Organization
					</a>
					<a
						href="mailto:karliatto@protonmail.com"
						class="text-sm text-muted-foreground transition-colors hover:text-foreground"
					>
						Contact Us
					</a>
				</nav>
			</div>
		</div>
	</div>
</footer>
