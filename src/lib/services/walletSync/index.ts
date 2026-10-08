import { electrumBackend } from './electrum';
import { rpcBackend } from './rpc';
import type { SyncBackend } from './types';

export type { SyncBackend, SyncProgress, SyncResult } from './types';

/** Available ways to sync the wallet, in the order the page lists them. */
export const SYNC_BACKENDS: SyncBackend[] = [electrumBackend, rpcBackend];

/** The backend to use when the user hasn't picked one: the first configured one. */
export const DEFAULT_BACKEND: SyncBackend =
	SYNC_BACKENDS.find((b) => b.serverPubkey) ?? SYNC_BACKENDS[0];
