//! BDK wallet wrapper compiled to WebAssembly.
//!
//! Unlike the Esplora-based Book of BDK example, this variant is driven by the
//! JavaScript side: the browser fetches blocks from a bitcoind RPC server over
//! ContextVM (MCP-over-Nostr) and feeds them here block-by-block. That keeps
//! the (async, websocket) transport in JS — where it works in the browser —
//! while BDK's chain logic stays in Rust/WASM.
//!
//! WASM constraints respected:
//! - in-memory wallet (`*_no_persist`); the `ChangeSet` is exported to JS for
//!   persistence in `localStorage`,
//! - only synchronous, non-networked methods are exposed (no threads, no time),
//! - block application uses `apply_block_connected_to`, which needs no clock.

use bdk_wallet::bitcoin::{consensus, Block, BlockHash, Network};
use bdk_wallet::chain::BlockId;
use bdk_wallet::chain::Merge;
use bdk_wallet::{ChangeSet, KeychainKind, Wallet};
use serde_json::{self, Value};
use std::str::FromStr;
use wasm_bindgen::prelude::*;

pub type JsResult<T> = Result<T, JsError>;

#[wasm_bindgen]
pub struct WalletWrapper {
    wallet: Wallet,
}

#[wasm_bindgen]
impl WalletWrapper {
    #[wasm_bindgen(constructor)]
    pub fn new(
        network: String,
        external_descriptor: String,
        internal_descriptor: String,
    ) -> Result<WalletWrapper, String> {
        #[cfg(feature = "console_error_panic_hook")]
        console_error_panic_hook::set_once();

        let network = parse_network(&network)?;

        let wallet = Wallet::create(external_descriptor, internal_descriptor)
            .network(network)
            .create_wallet_no_persist()
            .map_err(|e| format!("{:?}", e))?;

        Ok(WalletWrapper { wallet })
    }

    /// Reconstructs a wallet from a previously exported `ChangeSet` JSON string.
    pub fn load(
        changeset_str: &str,
        external_descriptor: &str,
        internal_descriptor: &str,
    ) -> JsResult<WalletWrapper> {
        #[cfg(feature = "console_error_panic_hook")]
        console_error_panic_hook::set_once();

        let changeset_value: Value = serde_json::from_str(changeset_str)?;
        let changeset: ChangeSet = serde_json::from_value(changeset_value)?;

        let wallet_opt = Wallet::load()
            .descriptor(KeychainKind::External, Some(external_descriptor.to_string()))
            .descriptor(KeychainKind::Internal, Some(internal_descriptor.to_string()))
            .extract_keys()
            .load_wallet_no_persist(changeset)?;

        let wallet = match wallet_opt {
            Some(wallet) => wallet,
            None => return Err(JsError::new("Failed to load wallet, check the changeset")),
        };

        Ok(WalletWrapper { wallet })
    }

    /// Height of the wallet's current chain tip (0 for a fresh wallet).
    pub fn tip_height(&self) -> u32 {
        self.wallet.latest_checkpoint().height()
    }

    /// Block hash of the wallet's current chain tip.
    pub fn tip_hash(&self) -> String {
        self.wallet.latest_checkpoint().hash().to_string()
    }

    /// Applies a raw block (consensus hex, as returned by `getblock <hash> 0`)
    /// at `height`, connecting it to the `connected_to` block.
    ///
    /// The caller drives this like `bdk_bitcoind_rpc::Emitter`: `connected_to`
    /// is the previously applied block, or `(0, genesis_hash)` for the first
    /// block after a fresh wallet (a gap connection to genesis is allowed).
    pub fn apply_block(
        &mut self,
        block_hex: &str,
        height: u32,
        connected_to_height: u32,
        connected_to_hash: &str,
    ) -> JsResult<()> {
        let block: Block = consensus::encode::deserialize_hex(block_hex)
            .map_err(|e| JsError::new(&format!("failed to decode block: {e}")))?;

        let connected_to = BlockId {
            height: connected_to_height,
            hash: BlockHash::from_str(connected_to_hash)
                .map_err(|e| JsError::new(&format!("invalid connected_to hash: {e}")))?,
        };

        self.wallet
            .apply_block_connected_to(&block, height, connected_to)
            .map_err(|e| JsError::new(&format!("failed to apply block: {e}")))?;

        Ok(())
    }

    /// Total confirmed + unconfirmed balance in satoshis.
    pub fn balance(&self) -> u64 {
        self.wallet.balance().total().to_sat()
    }

    pub fn reveal_next_address(&mut self) -> String {
        self.wallet
            .reveal_next_address(KeychainKind::External)
            .to_string()
    }

    pub fn peek_address(&self, index: u32) -> String {
        self.wallet
            .peek_address(KeychainKind::External, index)
            .to_string()
    }

    /// Serializes the pending (staged) changeset to a JSON string, or `"null"`.
    pub fn take_staged(&mut self) -> JsResult<String> {
        match self.wallet.take_staged() {
            Some(changeset) => {
                let value = serde_json::to_value(&changeset)?;
                Ok(serde_json::to_string(&value)?)
            }
            None => Ok("null".to_string()),
        }
    }

    /// Merges the pending changeset into `previous` and returns the JSON string.
    pub fn take_merged(&mut self, previous: String) -> JsResult<String> {
        match self.wallet.take_staged() {
            Some(curr_changeset) => {
                let previous_value: Value = serde_json::from_str(&previous)?;
                let mut previous_changeset: ChangeSet = serde_json::from_value(previous_value)?;
                previous_changeset.merge(curr_changeset);
                let final_value = serde_json::to_value(&previous_changeset)?;
                Ok(serde_json::to_string(&final_value)?)
            }
            None => Ok("null".to_string()),
        }
    }
}

fn parse_network(network: &str) -> Result<Network, String> {
    match network {
        // For now only regtest is supported
        // "mainnet" | "bitcoin" => Ok(Network::Bitcoin),
        // "testnet" => Ok(Network::Testnet),
        // "testnet4" => Ok(Network::Testnet4),
        // "signet" => Ok(Network::Signet),
        "regtest" => Ok(Network::Regtest),
        _ => Err("Invalid network".into()),
    }
}
