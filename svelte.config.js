import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isGitHubPages = process.env.GITHUB_PAGES === 'true';
const githubPagesBasePath = '/contextbtc-site';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({
			fallback: 'index.html'
		}),
		paths: {
			base: isGitHubPages ? githubPagesBasePath : ''
		},
		prerender: {
			crawl: true,
			handleHttpError: 'ignore'
		}
	}
};

export default config;
