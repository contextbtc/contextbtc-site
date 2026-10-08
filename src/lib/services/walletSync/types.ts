import type { WalletWrapper } from '$lib/wasm/bdk/bdk';

/**
 * A way of syncing the BDK wallet. Backends are independent of each other in
 * code (each has its own server and client) but all sync into the one shared
 * persisted wallet, so switching continues from where the other left off.
 * They are listed in `SYNC_BACKENDS` (`./index.ts`); removing a backend is
 * deleting its module and its entry there.
 */
export interface SyncBackend {
	/** Stable id, used to remember the user's choice. */
	id: string;
	label: string;
	/** One-line explanation shown on the wallet page. */
	description: string;
	/** ContextVM server the backend talks to ('' when not configured). */
	serverPubkey: string;
	sync(onProgress?: (p: SyncProgress) => void): Promise<SyncResult>;
}

export interface SyncProgress {
	/** Work done so far in the current phase. */
	done: number;
	/** Total work of the current phase. */
	total: number;
	/** Human-readable status, e.g. "Syncing block 4,321 / 5,000". */
	label: string;
}

export interface SyncResult {
	wallet: WalletWrapper;
	/** Chain tip height reported by the server. */
	tip: number;
	/** Whether the wallet reached the tip, or another sync call is needed. */
	caughtUp: boolean;
}
