import type { CallToolResult } from '@contextvm/mcp-sdk/types.js';
import { defineLocalTool, jsonResult, LocalToolSource, type LocalTool } from './local-tool-source';

/** The part of `src/lib/wasm/hal/hal.d.ts` used here. */
interface HalModule {
	runHal(args: string[], stdin?: string): Promise<{ code: number; stdout: string; stderr: string }>;
}

// `src/lib/wasm/hal` is gitignored and only exists after `bun run build:hal` (or
// in the Nix build), so it is globbed rather than imported: the glob is empty
// when hal isn't built, and the module (and hal.wasm) only load on first use.
const halLoaders = import.meta.glob<HalModule>('../../wasm/hal/hal.js');
const loadHal = Object.values(halLoaders).at(0);

const HAL_NETWORKS = ['mainnet', 'testnet', 'signet', 'regtest'] as const;
type HalNetwork = (typeof HAL_NETWORKS)[number];

const networkProperty = {
	type: 'string',
	enum: HAL_NETWORKS,
	default: 'mainnet',
	description: 'Bitcoin network, used to render addresses. Defaults to mainnet.'
} as const;

/** hal's global network flag (mainnet is its default). */
function networkFlags(network: unknown): string[] {
	const value = HAL_NETWORKS.includes(network as HalNetwork) ? (network as HalNetwork) : 'mainnet';
	return value === 'mainnet' ? [] : [`--${value}`];
}

/** Runs `hal <args...>`; JSON output becomes a JSON result, a non-zero exit an error. */
async function runHalJson(args: string[]): Promise<CallToolResult> {
	if (!loadHal) {
		throw new Error('hal-wasm is not built; run `bun run build:hal`.');
	}
	const { runHal } = await loadHal();
	const { code, stdout, stderr } = await runHal(args);
	if (code !== 0) {
		throw new Error(stderr.trim() || `hal exited with code ${code}`);
	}

	try {
		const parsed: unknown = JSON.parse(stdout);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return jsonResult(parsed as Record<string, unknown>);
		}
	} catch {
		// Not JSON: hand back the raw output.
	}
	return { content: [{ type: 'text', text: stdout.trim() }] };
}

/** Rejects xprv/tprv/zprv/...: the tools are read-only and keys must not reach the model. */
function requirePublicExtendedKey(key: unknown): string {
	const value = String(key ?? '').trim();
	if (/^[a-zA-Z]prv/.test(value)) {
		throw new Error('Private extended keys are not accepted; pass the xpub instead.');
	}
	return value;
}

const extKeyProperty = {
	type: 'string',
	pattern: '^[a-zA-Z]pub',
	description:
		'BIP-32 extended public key (xpub, tpub, ypub, zpub, ...). Private keys are rejected.'
} as const;

/**
 * Builds one read-only hal tool: `command` maps the validated arguments to
 * hal's command line.
 */
function halTool(
	name: string,
	title: string,
	description: string,
	properties: Record<string, object>,
	required: string[],
	command: (args: Record<string, unknown>) => string[]
): LocalTool {
	return defineLocalTool({
		tier: 'auto',
		definition: {
			name,
			title,
			description: `${description} Runs locally with hal (WASM).`,
			inputSchema: { type: 'object', properties, required, additionalProperties: false },
			annotations: { readOnlyHint: true, openWorldHint: false }
		},
		run: (args) => runHalJson(command(args))
	});
}

const tools = [
	halTool(
		'hal_tx_decode',
		'Decode transaction',
		'Decode a raw Bitcoin transaction (hex) to JSON: txid, inputs, outputs with addresses and amounts, weight.',
		{
			network: networkProperty,
			raw_tx: { type: 'string', pattern: '^[0-9a-fA-F]+$', description: 'Raw transaction in hex.' }
		},
		['raw_tx'],
		(args) => [...networkFlags(args.network), 'tx', 'decode', String(args.raw_tx)]
	),
	halTool(
		'hal_psbt_decode',
		'Decode PSBT',
		'Decode a partially signed Bitcoin transaction (PSBT, base64 or hex) to JSON, including its unsigned transaction, inputs and outputs.',
		{
			network: networkProperty,
			psbt: { type: 'string', description: 'The PSBT in base64 or hex.' }
		},
		['psbt'],
		(args) => [...networkFlags(args.network), 'psbt', 'decode', String(args.psbt)]
	),
	halTool(
		'hal_address_inspect',
		'Inspect address',
		'Inspect a Bitcoin address: its network, type (p2pkh, p2wpkh, p2tr, ...), witness program and scriptPubKey.',
		{ address: { type: 'string', description: 'The Bitcoin address.' } },
		['address'],
		(args) => ['address', 'inspect', String(args.address)]
	),
	halTool(
		'hal_script_decode',
		'Decode script',
		'Decode a Bitcoin script (hex) into its opcodes (ASM) and the addresses it corresponds to.',
		{
			network: networkProperty,
			script_hex: { type: 'string', pattern: '^[0-9a-fA-F]*$', description: 'Script in hex.' }
		},
		['script_hex'],
		(args) => [...networkFlags(args.network), 'script', 'decode', String(args.script_hex)]
	),
	halTool(
		'hal_bip32_inspect',
		'Inspect extended key',
		'Inspect a BIP-32 extended public key: network, depth, parent fingerprint, child number, chain code and public key.',
		{ ext_key: extKeyProperty },
		['ext_key'],
		(args) => ['bip32', 'inspect', requirePublicExtendedKey(args.ext_key)]
	),
	halTool(
		'hal_bip32_derive',
		'Derive from extended key',
		'Derive a child key from a BIP-32 extended public key along a non-hardened path (e.g. "m/0/5"), returning the child xpub, public key and addresses.',
		{
			ext_key: extKeyProperty,
			derivation_path: {
				type: 'string',
				description:
					'Derivation path relative to the key, e.g. "m/0/5". Hardened steps need a private key.'
			}
		},
		['ext_key', 'derivation_path'],
		(args) => [
			'bip32',
			'derive',
			requirePublicExtendedKey(args.ext_key),
			String(args.derivation_path)
		]
	),
	halTool(
		'hal_descriptor_inspect',
		'Inspect descriptor',
		'Inspect an output descriptor with miniscript: its type, keys, script and, for non-ranged descriptors, address.',
		{
			network: networkProperty,
			descriptor: { type: 'string', description: 'The output descriptor.' }
		},
		['descriptor'],
		(args) => [...networkFlags(args.network), 'miniscript', 'descriptor', String(args.descriptor)]
	)
];

/** hal tools, or null when hal-wasm isn't built (the chat then simply lacks them). */
export const halToolSource = loadHal
	? new LocalToolSource(
			'In-browser hal',
			'the hal Bitcoin CLI compiled to WASM, running locally in the browser, so no data leaves the page',
			tools
		)
	: null;
