import { browser } from '$app/environment';
import init, { WalletWrapper, genesis_hash, normalize_descriptors } from '$lib/wasm/bdk/bdk';
import bdkWasmUrl from '$lib/wasm/bdk/bdk_bg.wasm?url';
import { commonRelays } from './relay-pool';

/**
 * BDK WASM wallet core, independent of how the wallet is synced.
 *
 * The wallet is in-memory; its `ChangeSet` (including the synced chain tip) is
 * persisted to `localStorage`, so syncing resumes where it left off on the next
 * load. Each network + descriptor pair is its own wallet with its own storage
 * key; every sync backend (see `walletSync/`) loads and persists that same
 * wallet, so switching backend continues from what the other already synced.
 */

export const RELAYS = commonRelays;

export const NETWORKS = [
	{ id: 'mainnet', label: 'Mainnet' }
	// { id: 'testnet4', label: 'Testnet4' },
	// { id: 'testnet', label: 'Testnet3' },
	// { id: 'signet', label: 'Signet' },
	// { id: 'regtest', label: 'Regtest' }
] as const;
export type Network = (typeof NETWORKS)[number]['id'];
export const DEFAULT_NETWORK: Network = 'mainnet';

export function isNetwork(value: unknown): value is Network {
	return NETWORKS.some((n) => n.id === value);
}

/** A watch-only wallet: its network, and receive (external) and change (internal) descriptors. */
export interface WalletConfig {
	network: Network;
	external: string;
	internal: string;
	/**
	 * Wallet birthday: the first block height that can hold its transactions.
	 * Only block-by-block sync (RPC) uses it, on a fresh wallet; 0 = genesis.
	 */
	startHeight: number;
}

/** Env var holding the default descriptor pair of `network`. */
export function defaultDescriptorsEnvVar(network: Network): string {
	return network === 'mainnet'
		? 'VITE_DEFAULT_DESCRIPTORS_MAINNET'
		: 'VITE_DEFAULT_DESCRIPTORS_TESTNET';
}

/**
 * Default descriptor pair per network, set at build time as
 * `"<external> <internal>"` (descriptors never contain whitespace, but may
 * contain commas). Test networks share one pair, since tpub keys are valid on
 * all of them. Returns null when unset or malformed.
 */
export function defaultDescriptors(
	network: Network
): Pick<WalletConfig, 'external' | 'internal'> | null {
	// Literal `import.meta.env.X` accesses: Vite only inlines those.
	const value =
		network === 'mainnet'
			? import.meta.env.VITE_DEFAULT_DESCRIPTORS_MAINNET
			: import.meta.env.VITE_DEFAULT_DESCRIPTORS_TESTNET;
	const parts = (value ?? '').split(/\s+/).filter(Boolean);
	if (parts.length === 0) return null;
	if (parts.length !== 2) {
		console.warn(
			`${defaultDescriptorsEnvVar(network)} must be "<external> <internal>", separated by a space.`
		);
		return null;
	}
	return { external: parts[0], internal: parts[1] };
}

const SELECTED_NETWORK_KEY = 'wallet:network';
/** Where the last applied wallet config of each network is remembered. */
const selectedConfigKey = (network: Network) => `wallet:config:${network}`;

/**
 * cyrb53: a small, fast, non-cryptographic string hash. It only has to name a
 * storage slot, and unlike `crypto.subtle` it is synchronous and available
 * outside secure contexts.
 */
function cyrb53(str: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * localStorage key of the wallet for `c` (expects normalized descriptors). The
 * start height is not part of it: it doesn't change which wallet this is.
 */
function storageKey(c: WalletConfig): string {
	return `walletData:${c.network}:${cyrb53(`${c.external}\n${c.internal}`)}`;
}

const Store = {
	save(key: string, data: string | null): void {
		if (!browser || !data || data === 'null') return;
		localStorage.setItem(key, data);
	},
	load(key: string): string | null {
		if (!browser) return null;
		return localStorage.getItem(key);
	},
	clear(key: string): void {
		if (!browser) return;
		localStorage.removeItem(key);
	}
};

let wasmReady: Promise<unknown> | null = null;

function ensureWasm(): Promise<unknown> {
	if (!browser) throw new Error('BDK WASM can only run in the browser');
	if (!wasmReady) wasmReady = init({ module_or_path: bdkWasmUrl });
	return wasmReady;
}

/**
 * Validates a descriptor pair for `network` and returns it in canonical form
 * (public keys, with checksums), so equivalent inputs map to the same wallet.
 * Throws with BDK's message for invalid descriptors (including keys for
 * another network), and rejects private keys.
 */
export async function normalizeDescriptors(
	network: Network,
	external: string,
	internal: string
): Promise<Pick<WalletConfig, 'external' | 'internal'>> {
	await ensureWasm();
	return JSON.parse(normalize_descriptors(network, external, internal));
}

/**
 * Derives `count` addresses of `keychain` starting at index `start`, without
 * loading or persisting any wallet.
 */
export async function peekAddresses(
	network: Network,
	external: string,
	internal: string,
	keychain: 'external' | 'internal',
	start: number,
	count: number
): Promise<{ index: number; address: string }[]> {
	await ensureWasm();
	// `peek_address` only covers the external keychain: swap to reach the internal one.
	const wallet =
		keychain === 'external'
			? new WalletWrapper(network, external, internal)
			: new WalletWrapper(network, internal, external);
	try {
		return Array.from({ length: count }, (_, i) => ({
			index: start + i,
			address: wallet.peek_address(start + i)
		}));
	} finally {
		wallet.free();
	}
}

/**
 * Throws unless `serverGenesis` (the server's block 0 hash) is the genesis
 * block of `network`, so a wallet never syncs from another chain.
 */
export async function assertServerNetwork(
	network: Network,
	serverGenesis: string,
	serverLabel: string
): Promise<void> {
	await ensureWasm();
	if (serverGenesis !== genesis_hash(network)) {
		const actual = NETWORKS.find((n) => genesis_hash(n.id) === serverGenesis);
		throw new Error(
			`The ${serverLabel} server is on ${actual?.label ?? 'an unknown network'}, not ${network}.`
		);
	}
}

/** The last selected network, or {@link DEFAULT_NETWORK}. */
export function loadSelectedNetwork(): Network {
	try {
		const saved = localStorage.getItem(SELECTED_NETWORK_KEY);
		if (isNetwork(saved)) return saved;
	} catch {
		// Storage unavailable: use the default.
	}
	return DEFAULT_NETWORK;
}

export function saveSelectedNetwork(network: Network): void {
	try {
		localStorage.setItem(SELECTED_NETWORK_KEY, network);
	} catch {
		// Storage unavailable: the choice just isn't remembered.
	}
}

/** The last applied (already normalized) wallet config of `network`, if any. */
export function loadSelectedConfig(network: Network): WalletConfig | null {
	try {
		// Before networks were selectable, the (regtest) pair lived under this key.
		const legacy = network === 'regtest' ? localStorage.getItem('wallet:descriptors') : null;
		const saved = JSON.parse(localStorage.getItem(selectedConfigKey(network)) ?? legacy ?? 'null');
		if (typeof saved?.external === 'string' && typeof saved?.internal === 'string') {
			const startHeight = Number.isInteger(saved.startHeight) ? saved.startHeight : 0;
			return { network, external: saved.external, internal: saved.internal, startHeight };
		}
	} catch {
		// Storage unavailable or corrupt: nothing remembered.
	}
	return null;
}

export function saveSelectedConfig(c: WalletConfig): void {
	try {
		const { external, internal, startHeight } = c;
		localStorage.setItem(
			selectedConfigKey(c.network),
			JSON.stringify({ external, internal, startHeight })
		);
	} catch {
		// Storage unavailable: the choice just isn't remembered.
	}
}

/** Loads the wallet persisted for `c` or creates a fresh one (no network access). */
export async function loadOrCreateWallet(c: WalletConfig): Promise<WalletWrapper> {
	await ensureWasm();
	const stored = Store.load(storageKey(c));
	if (stored) {
		return WalletWrapper.load(stored, c.external, c.internal);
	}
	return new WalletWrapper(c.network, c.external, c.internal);
}

/** Persists the wallet's staged changes, merging with any previous data. */
export function persist(wallet: WalletWrapper, c: WalletConfig): void {
	const key = storageKey(c);
	const previous = Store.load(key);
	Store.save(key, previous ? wallet.take_merged(previous) : wallet.take_staged());
}

/** Total confirmed + unconfirmed balance in satoshis. */
export function getBalanceSats(wallet: WalletWrapper): bigint {
	return wallet.balance();
}

/** Reveals the next external address and persists the updated changeset. */
export function revealNextAddress(wallet: WalletWrapper, c: WalletConfig): string {
	const address = wallet.reveal_next_address();
	persist(wallet, c);
	return address;
}

/** Clears the persisted data of the wallet for `c` (forces a fresh sync next load). */
export function resetWallet(c: WalletConfig): void {
	Store.clear(storageKey(c));
}
