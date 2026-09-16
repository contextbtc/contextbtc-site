<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { cashuWallet } from '$lib/services/cashu-wallet.svelte';
	import { DIALOG_IDS, dialogState } from '$lib/stores/dialog-state.svelte';
	import ZapIcon from '@lucide/svelte/icons/zap';
</script>

<!-- Always shown, empty wallet included, so topping up is one click from anywhere. -->
<Button
	variant="outline"
	size="sm"
	class="gap-1.5 tabular-nums"
	title="Cashu wallet balance — click to top up"
	onclick={() => (dialogState.dialogId = DIALOG_IDS.WALLET)}
>
	<ZapIcon class="h-3.5 w-3.5 text-[#f7931a]" />
	{cashuWallet.balance.toLocaleString()} sats
</Button>
