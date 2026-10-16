import type { ChatToolSource } from './agent-orchestrator';
import { chatMcpServer, electrsMcpServer } from './chatMcpServer.svelte';
import { bdkToolSource } from './local-tools/bdk';
import { halToolSource } from './local-tools/hal';

/** A group of tools on the Tools page: one tool source. */
export interface ToolCategory {
	/** Also the section's anchor on the page. */
	id: string;
	label: string;
	description: string;
	/** Null when the source isn't available in this build; see `unavailable`. */
	source: ChatToolSource | null;
	unavailable?: string;
}

export const toolCategories: ToolCategory[] = [
	{
		id: 'node',
		label: 'Bitcoin Node',
		description: 'Bitcoin Core RPCs of the ContextBTC node, reached over Nostr via ContextVM.',
		source: chatMcpServer
	},
	{
		id: 'electrs',
		label: 'Electrs',
		description: 'Electrum protocol methods of the ContextBTC electrs server, over ContextVM.',
		source: electrsMcpServer
	},
	{
		id: 'hal',
		label: 'Hal',
		description: 'The hal Bitcoin CLI compiled to WASM, running locally in your browser.',
		source: halToolSource,
		unavailable: 'hal-wasm is not built in this deployment (run `bun run build:hal`).'
	},
	{
		id: 'bdk',
		label: 'BDK wallet tools',
		description: 'Descriptor tools from BDK compiled to WASM, running locally in your browser.',
		source: bdkToolSource
	}
];
