/* tslint:disable */
/* eslint-disable */

export class WalletWrapper {
	free(): void;
	[Symbol.dispose](): void;
	/**
	 * Applies a raw block (consensus hex, as returned by `getblock <hash> 0`)
	 * at `height`, connecting it to the `connected_to` block.
	 *
	 * The caller drives this like `bdk_bitcoind_rpc::Emitter`: `connected_to`
	 * is the previously applied block, or `(0, genesis_hash)` for the first
	 * block after a fresh wallet (a gap connection to genesis is allowed).
	 */
	apply_block(
		block_hex: string,
		height: number,
		connected_to_height: number,
		connected_to_hash: string
	): void;
	/**
	 * Total confirmed + unconfirmed balance in satoshis.
	 */
	balance(): bigint;
	/**
	 * Reconstructs a wallet from a previously exported `ChangeSet` JSON string.
	 */
	static load(
		changeset_str: string,
		external_descriptor: string,
		internal_descriptor: string
	): WalletWrapper;
	constructor(network: string, external_descriptor: string, internal_descriptor: string);
	peek_address(index: number): string;
	reveal_next_address(): string;
	/**
	 * Merges the pending changeset into `previous` and returns the JSON string.
	 */
	take_merged(previous: string): string;
	/**
	 * Serializes the pending (staged) changeset to a JSON string, or `"null"`.
	 */
	take_staged(): string;
	/**
	 * Block hash of the wallet's current chain tip.
	 */
	tip_hash(): string;
	/**
	 * Height of the wallet's current chain tip (0 for a fresh wallet).
	 */
	tip_height(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
	readonly memory: WebAssembly.Memory;
	readonly __wbg_walletwrapper_free: (a: number, b: number) => void;
	readonly walletwrapper_apply_block: (
		a: number,
		b: number,
		c: number,
		d: number,
		e: number,
		f: number,
		g: number
	) => [number, number];
	readonly walletwrapper_balance: (a: number) => bigint;
	readonly walletwrapper_load: (
		a: number,
		b: number,
		c: number,
		d: number,
		e: number,
		f: number
	) => [number, number, number];
	readonly walletwrapper_new: (
		a: number,
		b: number,
		c: number,
		d: number,
		e: number,
		f: number
	) => [number, number, number];
	readonly walletwrapper_peek_address: (a: number, b: number) => [number, number];
	readonly walletwrapper_reveal_next_address: (a: number) => [number, number];
	readonly walletwrapper_take_merged: (
		a: number,
		b: number,
		c: number
	) => [number, number, number, number];
	readonly walletwrapper_take_staged: (a: number) => [number, number, number, number];
	readonly walletwrapper_tip_hash: (a: number) => [number, number];
	readonly walletwrapper_tip_height: (a: number) => number;
	readonly rustsecp256k1_v0_10_0_context_create: (a: number) => number;
	readonly rustsecp256k1_v0_10_0_context_destroy: (a: number) => void;
	readonly rustsecp256k1_v0_10_0_default_error_callback_fn: (a: number, b: number) => void;
	readonly rustsecp256k1_v0_10_0_default_illegal_callback_fn: (a: number, b: number) => void;
	readonly __wbindgen_free: (a: number, b: number, c: number) => void;
	readonly __wbindgen_malloc: (a: number, b: number) => number;
	readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
	readonly __wbindgen_externrefs: WebAssembly.Table;
	readonly __externref_table_dealloc: (a: number) => void;
	readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init(
	module_or_path?:
		| { module_or_path: InitInput | Promise<InitInput> }
		| InitInput
		| Promise<InitInput>
): Promise<InitOutput>;
