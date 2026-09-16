// Dialog ID constants
export const DIALOG_IDS = {
	RELAY_CHANGE: 'relay-change',
	LOGIN: 'login',
	RELAY_SELECTOR: 'relay-selector',
	WALLET: 'cashu-wallet'
} as const;

// Reactive dialog state object using Svelte 5 $state
export const dialogState = $state<{ dialogId: string | null }>({
	dialogId: null
});
