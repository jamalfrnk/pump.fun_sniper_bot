use anyhow::{Result, Context};
use log::{info, warn, error};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Signer;
use solana_client::rpc_client::RpcClient;
use solana_client::rpc_config::RpcSendTransactionConfig;
use solana_sdk::commitment_config::CommitmentConfig;
use solana_sdk::transaction::Transaction;
use std::time::{Duration, Instant};
use std::thread::sleep;

// Maximum retry attempts for transactions
const MAX_RETRIES: u8 = 3;
// Retry delay in milliseconds
const RETRY_DELAY_MS: u64 = 500;

// Send a transaction with automatic retry on failure
pub fn send_transaction_with_retry(
    rpc_client: &RpcClient,
    transaction: &Transaction,
    signers: &[&dyn Signer],
) -> Result<String> {
    let mut last_error = None;
    
    for attempt in 1..=MAX_RETRIES {
        let blockhash = rpc_client.get_latest_blockhash()
            .context("Failed to get recent blockhash")?;
        
        let mut tx = transaction.clone();
        tx.sign(signers, blockhash);
        
        match rpc_client.send_and_confirm_transaction_with_spinner(&tx) {
            Ok(signature) => {
                return Ok(signature.to_string());
            },
            Err(err) => {
                warn!("Transaction failed on attempt {}/{}: {}", attempt, MAX_RETRIES, err);
                last_error = Some(err);
                
                if attempt < MAX_RETRIES {
                    sleep(Duration::from_millis(RETRY_DELAY_MS));
                }
            }
        }
    }
    
    Err(anyhow::anyhow!("Transaction failed after {} attempts: {:?}", MAX_RETRIES, last_error))
}

// Format lamports as SOL with appropriate precision
pub fn format_sol_amount(lamports: u64) -> String {
    let sol = lamports as f64 / 1_000_000_000.0;
    format!("{:.9} SOL", sol)
}

// Format token amount with appropriate decimals (usually 6 for Pump.fun tokens)
pub fn format_token_amount(amount: u64, decimals: u8) -> String {
    let factor = 10u64.pow(decimals as u32) as f64;
    let formatted = amount as f64 / factor;
    format!("{:.9}", formatted)
}

// Check if the given pubkey has an associated token account for the given mint
pub async fn has_token_account(
    rpc_client: &RpcClient,
    wallet: &Pubkey,
    mint: &Pubkey,
) -> Result<bool> {
    let token_account = spl_associated_token_account::get_associated_token_address(
        wallet,
        mint,
    );
    
    match rpc_client.get_account(&token_account) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

// Calculate profit/loss from a trade
pub fn calculate_profit(
    buy_price: f64, 
    sell_price: f64, 
    amount: f64,
) -> (f64, f64) {
    let profit_amount = (sell_price - buy_price) * amount;
    let profit_percentage = (sell_price / buy_price - 1.0) * 100.0;
    
    (profit_amount, profit_percentage)
}
