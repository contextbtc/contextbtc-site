// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

/**
 * Build-time env vars. Only VITE_-prefixed names are inlined by Vite, and they
 * land in the public bundle — declaring them here turns a typo into a compile
 * error instead of a silent fallback.
 */
interface ImportMetaEnv {
	readonly VITE_BITCOINCORE_SERVER_PUBKEY?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

export {};
