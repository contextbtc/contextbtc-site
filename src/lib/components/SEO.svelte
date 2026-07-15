<script lang="ts">
	import { asset } from '$app/paths';
	import { page } from '$app/stores';

	const defaultOgImageSrc = asset('/logo-black.svg');
	const faviconSrc = asset('/favicon.svg');

	let {
		title = 'ContextBTC',
		description = 'ContextBTC — a project with the goal of building infrastructure tools for the Bitcoin ecosystem.',
		url = $page.url.href,
		image = defaultOgImageSrc,
		type = 'website' as 'website' | 'article',
		siteName = 'ContextBTC',
		locale = 'en_US'
	} = $props();

	// Generate the full title by combining site name and page title
	const fullTitle = $derived(
		`${title || 'Untitled'} ${title === 'ContextBTC' ? '' : `| ${siteName}`}`.trim()
	);
</script>

<svelte:head>
	<title>{fullTitle}</title>
	<meta name="description" content={description} />

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content={type} />
	<meta property="og:url" content={url} />
	<meta property="og:title" content={fullTitle} />
	<meta property="og:description" content={description} />
	<meta property="og:image" content={image} />
	<meta property="og:site_name" content={siteName} />
	<meta property="og:locale" content={locale} />

	<!-- Twitter -->
	<meta property="twitter:card" content="summary_large_image" />
	<meta property="twitter:url" content={url} />
	<meta property="twitter:title" content={fullTitle} />
	<meta property="twitter:description" content={description} />
	<meta property="twitter:image" content={image} />

	<!-- Additional SEO meta tags -->
	<meta name="author" content={siteName} />
	<meta name="robots" content="index, follow" />

	<!-- Favicon references -->
	<link rel="icon" href={faviconSrc} />
	<link rel="canonical" href={url} />
</svelte:head>
