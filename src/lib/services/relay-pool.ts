import { RelayPool } from 'applesauce-relay';

// Create a single relay pool instance for the entire application
export const relayPool = new RelayPool();

const COMMON_RELAYS_ENV = 'VITE_CONTEXTBTC_RELAYS';
export const METADATA_RELAYS_ENV = 'VITE_METADATA_RELAYS';

/** Parses a comma- (or whitespace-) separated list of relay URLs. */
function parseRelays(value?: string): string[] {
	return (value ?? '').split(/[\s,]+/).filter(Boolean);
}

// Relays are set at build time and may be empty: nothing throws at import
// (this module is loaded on every page), so features check them with the
// `require*` functions below when they connect.

/** ContextVM relays used by the chat, the wallet and the MCP clients. */
export const commonRelays = parseRelays(import.meta.env.VITE_CONTEXTBTC_RELAYS);
/** Relays to fetch and publish profile metadata on. */
export const metadataRelays = parseRelays(import.meta.env.VITE_METADATA_RELAYS);

/** Returns `relays`, or throws naming the env var that should have set them. */
function requireRelays(relays: string[], envVar: string): string[] {
	if (relays.length === 0) {
		throw new Error(`${envVar} is not set; add it to .env (see .env.example).`);
	}
	const invalid = relays.find((r) => !/^wss?:\/\//.test(r));
	if (invalid) {
		throw new Error(`${envVar} has an invalid relay URL "${invalid}"; expected ws:// or wss://.`);
	}
	return relays;
}

export function requireCommonRelays(): string[] {
	return requireRelays(commonRelays, COMMON_RELAYS_ENV);
}

export function requireMetadataRelays(): string[] {
	return requireRelays(metadataRelays, METADATA_RELAYS_ENV);
}
