//! BDK wallet wrapper compiled to WebAssembly.
//!
//! Unlike the Esplora-based Book of BDK example, this variant is driven by the
//! JavaScript side, over ContextVM (MCP-over-Nostr), from one of two backends:
//! - bitcoind RPC: blocks are fed here one by one (`apply_block`),
//! - Electrum (electrs): script histories, transactions and merkle proofs are
//!   gathered by JS and turned into a BDK `Update` here (`apply_electrum_update`).
//!
//! That keeps the (async, websocket) transport in JS — where it works in the
//! browser — while BDK's chain logic stays in Rust/WASM.
//!
//! WASM constraints respected:
//! - in-memory wallet (`*_no_persist`); the `ChangeSet` is exported to JS for
//!   persistence in `localStorage`,
//! - only synchronous, non-networked methods are exposed (no threads, no time),
//! - block application uses `apply_block_connected_to`, which needs no clock,
//!   and Electrum updates use `apply_update_at` with a JS-provided timestamp.

use bdk_wallet::bitcoin::block::Header;
use bdk_wallet::bitcoin::hashes::{sha256, sha256d, Hash};
use bdk_wallet::bitcoin::hex::DisplayHex;
use bdk_wallet::bitcoin::{
    consensus, Block, BlockHash, Network, Script, Transaction, TxMerkleNode, Txid,
};
use bdk_wallet::chain::{BlockId, ConfirmationBlockTime, Merge, TxUpdate};
use bdk_wallet::{ChangeSet, KeychainKind, Update, Wallet};
use serde::{Deserialize, Serialize};
use serde_json::{self, Value};
use std::collections::BTreeMap;
use std::str::FromStr;
use std::sync::Arc;
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

    /// Electrum script hashes of `count` scripts of `keychain` ("external" or
    /// "internal") starting at derivation `start`, as a JSON
    /// `[{index, scripthash}]` string. Derivation does not reveal addresses.
    pub fn scripthashes(&self, keychain: &str, start: u32, count: u32) -> JsResult<String> {
        let keychain = parse_keychain(keychain)?;
        let entries: Vec<ScripthashEntry> = (start..start.saturating_add(count))
            .map(|index| ScripthashEntry {
                index,
                scripthash: electrum_scripthash(
                    &self.wallet.peek_address(keychain, index).script_pubkey(),
                ),
            })
            .collect();
        Ok(serde_json::to_string(&entries)?)
    }

    /// Applies the result of an Electrum scan, gathered by JS (see
    /// [`ElectrumUpdate`] for the JSON shape).
    ///
    /// Each confirmed transaction's merkle proof is checked against the
    /// header of its block before it is anchored there, since the Electrum
    /// server is remote and not trusted. `seen_at` (unix seconds) is the
    /// last-seen time recorded for unconfirmed transactions; it is passed in
    /// because wasm32 has no clock.
    pub fn apply_electrum_update(&mut self, update_json: &str, seen_at: u64) -> JsResult<()> {
        let input: ElectrumUpdate = serde_json::from_str(update_json)?;
        let update = self.build_electrum_update(input).map_err(|e| JsError::new(&e))?;
        self.wallet
            .apply_update_at(update, seen_at)
            .map_err(|e| JsError::new(&format!("failed to apply update: {e}")))?;
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

impl WalletWrapper {
    fn build_electrum_update(&self, input: ElectrumUpdate) -> Result<Update, String> {
        let headers = input
            .blocks
            .iter()
            .map(|b| Ok((b.height, decode_header(&b.header)?)))
            .collect::<Result<BTreeMap<u32, Header>, String>>()?;
        let tip_header = decode_header(&input.tip.header)?;

        let mut tx_update = TxUpdate::<ConfirmationBlockTime>::default();
        for hex in &input.txs {
            let tx: Transaction = consensus::encode::deserialize_hex(hex)
                .map_err(|e| format!("failed to decode transaction: {e}"))?;
            tx_update.txs.push(Arc::new(tx));
        }

        for c in &input.confirmed {
            let txid = Txid::from_str(&c.txid).map_err(|e| format!("invalid txid: {e}"))?;
            let header = headers
                .get(&c.height)
                .ok_or_else(|| format!("missing header at height {}", c.height))?;
            if !merkle_proof_is_valid(txid, c.pos, &c.merkle, header)? {
                return Err(format!(
                    "invalid merkle proof for {txid} at height {}",
                    c.height
                ));
            }
            let anchor = ConfirmationBlockTime {
                block_id: BlockId {
                    height: c.height,
                    hash: header.block_hash(),
                },
                confirmation_time: header.time as u64,
            };
            tx_update.anchors.insert((anchor, txid));
        }

        // Extend the wallet's own chain so the update always connects to it.
        // `insert` replaces a block at an existing height, which also drops
        // everything above it: that is how a reorg seen at the previous tip
        // (re-fetched by the caller) evicts the stale blocks.
        let mut cp = self.wallet.latest_checkpoint();
        for (&height, header) in &headers {
            cp = cp.insert(BlockId {
                height,
                hash: header.block_hash(),
            });
        }
        cp = cp.insert(BlockId {
            height: input.tip.height,
            hash: tip_header.block_hash(),
        });

        let mut last_active_indices = BTreeMap::new();
        if let Some(i) = input.last_active.external {
            last_active_indices.insert(KeychainKind::External, i);
        }
        if let Some(i) = input.last_active.internal {
            last_active_indices.insert(KeychainKind::Internal, i);
        }

        Ok(Update {
            last_active_indices,
            tx_update,
            chain: Some(cp),
        })
    }
}

/// Electrum scan result handed over by JS to
/// [`WalletWrapper::apply_electrum_update`]. Headers are raw consensus hex
/// (`blockchain.block.header`); `merkle`/`pos` come from
/// `blockchain.transaction.get_merkle`.
#[derive(Deserialize)]
struct ElectrumUpdate {
    tip: HeaderAt,
    /// Headers of every block a confirmed tx is in, plus any block the
    /// caller wants checked against the wallet's chain (e.g. its old tip).
    #[serde(default)]
    blocks: Vec<HeaderAt>,
    /// Raw hex of every relevant transaction (confirmed and unconfirmed).
    #[serde(default)]
    txs: Vec<String>,
    #[serde(default)]
    confirmed: Vec<ConfirmedTx>,
    #[serde(default)]
    last_active: LastActive,
}

#[derive(Deserialize)]
struct HeaderAt {
    height: u32,
    header: String,
}

#[derive(Deserialize)]
struct ConfirmedTx {
    txid: String,
    height: u32,
    pos: u32,
    merkle: Vec<String>,
}

#[derive(Deserialize, Default)]
struct LastActive {
    external: Option<u32>,
    internal: Option<u32>,
}

#[derive(Serialize)]
struct ScripthashEntry {
    index: u32,
    scripthash: String,
}

fn decode_header(hex: &str) -> Result<Header, String> {
    consensus::encode::deserialize_hex(hex).map_err(|e| format!("failed to decode header: {e}"))
}

/// Electrum script hash: sha256 of the script, byte-reversed, as hex.
fn electrum_scripthash(script: &Script) -> String {
    let mut bytes = sha256::Hash::hash(script.as_bytes()).to_byte_array();
    bytes.reverse();
    bytes.to_lower_hex_string()
}

/// Checks an Electrum merkle branch (`blockchain.transaction.get_merkle`)
/// for `txid` at position `pos` against the header's merkle root.
fn merkle_proof_is_valid(
    txid: Txid,
    pos: u32,
    merkle: &[String],
    header: &Header,
) -> Result<bool, String> {
    let mut index = pos;
    let mut node = txid.to_raw_hash().to_byte_array();
    for sibling in merkle {
        let sibling = TxMerkleNode::from_str(sibling)
            .map_err(|e| format!("invalid merkle branch: {e}"))?
            .to_byte_array();
        let mut concat = [0u8; 64];
        let (left, right) = if index % 2 == 0 {
            (node, sibling)
        } else {
            (sibling, node)
        };
        concat[..32].copy_from_slice(&left);
        concat[32..].copy_from_slice(&right);
        node = sha256d::Hash::hash(&concat).to_byte_array();
        index /= 2;
    }
    Ok(node == header.merkle_root.to_byte_array())
}

fn parse_keychain(keychain: &str) -> JsResult<KeychainKind> {
    match keychain {
        "external" => Ok(KeychainKind::External),
        "internal" => Ok(KeychainKind::Internal),
        _ => Err(JsError::new("keychain must be \"external\" or \"internal\"")),
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

#[cfg(test)]
mod tests {
    use super::*;
    use bdk_wallet::bitcoin::constants::genesis_block;
    use bdk_wallet::bitcoin::{merkle_tree, ScriptBuf};

    #[test]
    fn scripthash_matches_electrum_docs() {
        // P2PKH of 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa, from the Electrum protocol docs.
        let script =
            ScriptBuf::from_hex("76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac").unwrap();
        assert_eq!(
            electrum_scripthash(&script),
            "8b01df4e368ea28f8dc0423bcf7a4923e3a12d307c875e47a0cfbf90b5c39161"
        );
    }

    /// A header whose merkle root commits to `txids`.
    fn header_for(txids: &[Txid]) -> Header {
        let mut header = genesis_block(Network::Regtest).header;
        header.merkle_root =
            merkle_tree::calculate_root(txids.iter().map(|t| t.to_raw_hash().into())).unwrap();
        header
    }

    fn node_hex(left: Txid, right: Txid) -> String {
        let mut concat = [0u8; 64];
        concat[..32].copy_from_slice(&left.to_byte_array());
        concat[32..].copy_from_slice(&right.to_byte_array());
        TxMerkleNode::from_byte_array(sha256d::Hash::hash(&concat).to_byte_array()).to_string()
    }

    #[test]
    fn merkle_proof_accepts_valid_and_rejects_tampered() {
        let [a, b, c] = [1u8, 2, 3].map(|n| Txid::from_byte_array([n; 32]));
        let header = header_for(&[a, b, c]);

        // Leaves [a, b, c, c]: c's sibling is itself, then hash(a‖b).
        let branch = vec![
            TxMerkleNode::from_byte_array(c.to_byte_array()).to_string(),
            node_hex(a, b),
        ];
        assert!(merkle_proof_is_valid(c, 2, &branch, &header).unwrap());

        // Wrong position, wrong tx, or a tampered branch must all fail.
        assert!(!merkle_proof_is_valid(c, 1, &branch, &header).unwrap());
        assert!(!merkle_proof_is_valid(a, 2, &branch, &header).unwrap());
        let mut tampered = branch.clone();
        tampered[1] = node_hex(b, a);
        assert!(!merkle_proof_is_valid(c, 2, &tampered, &header).unwrap());
    }

    #[test]
    fn single_tx_block_has_empty_branch() {
        let header = genesis_block(Network::Regtest).header;
        let txid = genesis_block(Network::Regtest).txdata[0].compute_txid();
        assert!(merkle_proof_is_valid(txid, 0, &[], &header).unwrap());
    }
}
