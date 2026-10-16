import type { ChatToolSource } from '$lib/services/agent-orchestrator';
import { bdkToolSource } from './bdk';
import { halToolSource } from './hal';

/** Tool sources that run in the page itself (WASM), offered to the chat next to the remote server. */
export const localToolSources: ChatToolSource[] = [
	bdkToolSource,
	...(halToolSource ? [halToolSource] : [])
];
