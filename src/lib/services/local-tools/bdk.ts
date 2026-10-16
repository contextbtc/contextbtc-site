import { NETWORKS, type Network, normalizeDescriptors, peekAddresses } from '../bdkWallet';
import { defineLocalTool, jsonResult, LocalToolSource } from './local-tool-source';

const MAX_DERIVE_COUNT = 100;

const descriptorPairProperties = {
	network: {
		type: 'string',
		enum: NETWORKS.map((n) => n.id),
		description: 'Bitcoin network the descriptors belong to.'
	},
	external: {
		type: 'string',
		description: 'Receive (external) output descriptor, e.g. "wpkh([fp/84h/0h/0h]xpub.../0/*)".'
	},
	internal: {
		type: 'string',
		description: 'Change (internal) output descriptor, e.g. "wpkh([fp/84h/0h/0h]xpub.../1/*)".'
	}
} as const;

interface DescriptorPairArgs {
	network: Network;
	external: string;
	internal: string;
}

/**
 * Descriptor tools backed by the BDK WASM build. They are pure computation on
 * descriptors given in the conversation — nothing is read from or written to
 * the user's saved wallet — so they run without approval.
 */
export const bdkToolSource = new LocalToolSource(
	'In-browser BDK',
	'running locally in the browser (BDK compiled to WASM), so no data leaves the page',
	[
		defineLocalTool({
			tier: 'auto',
			definition: {
				name: 'bdk_normalize_descriptors',
				title: 'Normalize descriptors',
				description:
					'Validate a watch-only output descriptor pair (receive + change) with BDK and return it ' +
					'in canonical form: public keys and checksums added. Fails with the reason when a ' +
					'descriptor is invalid, belongs to another network, or contains private keys.',
				inputSchema: {
					type: 'object',
					properties: descriptorPairProperties,
					required: ['network', 'external', 'internal'],
					additionalProperties: false
				},
				annotations: { readOnlyHint: true, openWorldHint: false }
			},
			async run(args) {
				const { network, external, internal } = args as unknown as DescriptorPairArgs;
				return jsonResult(await normalizeDescriptors(network, external, internal));
			}
		}),
		defineLocalTool({
			tier: 'auto',
			definition: {
				name: 'bdk_derive_addresses',
				title: 'Derive addresses',
				description:
					'Derive Bitcoin addresses from a watch-only descriptor pair with BDK, without touching ' +
					'any saved wallet. Returns [{index, address}] for the chosen keychain ("external" = ' +
					`receive, "internal" = change), starting at derivation index \`start\` (max ${MAX_DERIVE_COUNT} per call).`,
				inputSchema: {
					type: 'object',
					properties: {
						...descriptorPairProperties,
						keychain: {
							type: 'string',
							enum: ['external', 'internal'],
							default: 'external',
							description: 'Which keychain to derive from: receive (external) or change (internal).'
						},
						start: {
							type: 'integer',
							minimum: 0,
							default: 0,
							description: 'First derivation index.'
						},
						count: {
							type: 'integer',
							minimum: 1,
							maximum: MAX_DERIVE_COUNT,
							default: 10,
							description: 'How many consecutive addresses to derive.'
						}
					},
					required: ['network', 'external', 'internal'],
					additionalProperties: false
				},
				annotations: { readOnlyHint: true, openWorldHint: false }
			},
			async run(args) {
				const { network, external, internal } = args as unknown as DescriptorPairArgs;
				const keychain = args.keychain === 'internal' ? 'internal' : 'external';
				const start = typeof args.start === 'number' ? args.start : 0;
				const count = typeof args.count === 'number' ? args.count : 10;
				const addresses = await peekAddresses(network, external, internal, keychain, start, count);
				return jsonResult({ network, keychain, addresses });
			}
		})
	]
);
