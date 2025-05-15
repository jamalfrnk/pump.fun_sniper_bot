use std::str::FromStr;
use anyhow::{Result, Context, anyhow};
use chrono::{DateTime, Utc};
use log::{info, warn, error, debug};
use solana_sdk::signature::{Keypair, Signature, Signer};
use solana_sdk::pubkey::Pubkey;
use solana_client::rpc_client::RpcClient;
use spl_associated_token_account::{get_associated_token_address, instruction::create_associated_token_account};
use spl_token::instruction as token_instruction;
use solana_sdk::transaction::Transaction;
use solana_sdk::instruction::Instruction;
use jup_ag::quote::{QuoteParams, QuoteResponse};
use jup_ag::swap::{SwapParams, SwapResponse, SwapInterfaceInner};
use serde_json::json;
use reqwest;

// Default SOL mint address (needed for Jupiter API)
const SOL_MINT: &str = "So11111111111111111111111111111111111111112";

// Represents a token position
pub struct TokenPosition {
    pub mint_address: Pubkey,
    pub name: String,
    pub symbol: String,
    pub buy_price: f64,
    pub buy_amount_sol: f64,
    pub token_amount: f64,
    pub current_price: f64,
    pub buy_time: DateTime<Utc>,
    pub profit_target_1: f64,
    pub profit_target_2: f64,
    pub sold_percentage: f64,
    pub last_updated: DateTime<Utc>,
    pub status: String,
}

// Information returned after a successful buy
pub struct BuyInfo {
    pub sol_amount: f64,
    pub token_amount: f64,
    pub token_price: f64,
    pub transaction_signature: String,
}

// Buy a token using Jupiter Aggregator
pub async fn buy_token(
    rpc_url: &str,
    keypair: &Keypair,
    mint_address: &Pubkey,
    amount_sol: f64,
    slippage_bps: u64,
) -> Result<BuyInfo> {
    let client = reqwest::Client::new();
    let wallet_pubkey = keypair.pubkey();
    
    info!("Preparing to buy token {} with {} SOL", mint_address, amount_sol);
    
    // Convert SOL amount to lamports
    let amount_lamports = (amount_sol * 1_000_000_000.0) as u64;
    
    // 1. Get a swap quote from Jupiter
    let quote_url = "https://quote-api.jup.ag/v6/quote";
    let quote_params = json!({
        "inputMint": SOL_MINT,
        "outputMint": mint_address.to_string(),
        "amount": amount_lamports,
        "slippageBps": slippage_bps,
        "swapMode": "ExactIn",
        "maxAccounts": 15
    });
    
    debug!("Requesting Jupiter quote...");
    let quote_response = client.get(quote_url)
        .query(&quote_params)
        .send()
        .await
        .context("Failed to get Jupiter quote")?;
    
    if !quote_response.status().is_success() {
        let error_text = quote_response.text().await?;
        return Err(anyhow!("Jupiter quote API error: {}", error_text));
    }
    
    let quote: QuoteResponse = quote_response.json().await
        .context("Failed to parse Jupiter quote response")?;
    
    let output_amount = quote.out_amount;
    let price_per_token = amount_sol / (output_amount as f64 / 1_000_000.0); // Assuming 6 decimals for Pump tokens
    
    info!("Quote received: {} SOL -> {} tokens, price: {} SOL per token", 
          amount_sol, output_amount as f64 / 1_000_000.0, price_per_token);
    
    // 2. Get swap instructions from Jupiter
    let swap_url = "https://quote-api.jup.ag/v6/swap";
    let swap_params = json!({
        "userPublicKey": wallet_pubkey.to_string(),
        "quoteResponse": quote,
        "wrapAndUnwrapSol": true,
        "feeAccount": wallet_pubkey.to_string(),
    });
    
    debug!("Requesting Jupiter swap instructions...");
    let swap_response = client.post(swap_url)
        .json(&swap_params)
        .send()
        .await
        .context("Failed to get Jupiter swap instructions")?;
    
    if !swap_response.status().is_success() {
        let error_text = swap_response.text().await?;
        return Err(anyhow!("Jupiter swap API error: {}", error_text));
    }
    
    let swap: SwapResponse = swap_response.json().await
        .context("Failed to parse Jupiter swap response")?;
    
    let tx_data = swap.swap_transaction;
    
    // 3. Execute the swap transaction
    let rpc_client = RpcClient::new(rpc_url);
    
    // Deserialize the transaction
    let tx_bytes = base64::decode(&tx_data)
        .context("Failed to decode transaction data")?;
    
    let mut tx: Transaction = bincode::deserialize(&tx_bytes)
        .context("Failed to deserialize transaction")?;
    
    // Sign the transaction
    tx.try_partial_sign(&[keypair], rpc_client.get_latest_blockhash()?)
        .context("Failed to sign transaction")?;
    
    // Send the transaction
    debug!("Sending buy transaction...");
    let signature = rpc_client.send_and_confirm_transaction_with_spinner(&tx)
        .context("Failed to send and confirm transaction")?;
    
    info!("Buy transaction confirmed: {}", signature);
    
    // Return buy information
    Ok(BuyInfo {
        sol_amount: amount_sol,
        token_amount: output_amount as f64 / 1_000_000.0, // Assuming 6 decimals
        token_price: price_per_token,
        transaction_signature: signature.to_string(),
    })
}

// Sell a token using Jupiter Aggregator
pub async fn sell_token(
    rpc_url: &str,
    keypair: &Keypair,
    mint_address: &Pubkey,
    token_amount: u64, // Amount in token's smallest unit (e.g., for 6 decimals: 1.0 token = 1,000,000 units)
    slippage_bps: u64,
) -> Result<String> {
    let client = reqwest::Client::new();
    let wallet_pubkey = keypair.pubkey();
    
    info!("Preparing to sell {} tokens of mint {}", token_amount as f64 / 1_000_000.0, mint_address);
    
    // 1. Get a swap quote from Jupiter (token -> SOL)
    let quote_url = "https://quote-api.jup.ag/v6/quote";
    let quote_params = json!({
        "inputMint": mint_address.to_string(),
        "outputMint": SOL_MINT,
        "amount": token_amount,
        "slippageBps": slippage_bps,
        "swapMode": "ExactIn",
        "maxAccounts": 15
    });
    
    debug!("Requesting Jupiter quote for sell...");
    let quote_response = client.get(quote_url)
        .query(&quote_params)
        .send()
        .await
        .context("Failed to get Jupiter quote for sell")?;
    
    if !quote_response.status().is_success() {
        let error_text = quote_response.text().await?;
        return Err(anyhow!("Jupiter quote API error for sell: {}", error_text));
    }
    
    let quote: QuoteResponse = quote_response.json().await
        .context("Failed to parse Jupiter quote response for sell")?;
    
    let sol_output = quote.out_amount as f64 / 1_000_000_000.0; // Convert from lamports to SOL
    
    info!("Sell quote received: {} tokens -> {} SOL", 
          token_amount as f64 / 1_000_000.0, sol_output);
    
    // 2. Get swap instructions from Jupiter
    let swap_url = "https://quote-api.jup.ag/v6/swap";
    let swap_params = json!({
        "userPublicKey": wallet_pubkey.to_string(),
        "quoteResponse": quote,
        "wrapAndUnwrapSol": true,
        "feeAccount": wallet_pubkey.to_string(),
    });
    
    debug!("Requesting Jupiter swap instructions for sell...");
    let swap_response = client.post(swap_url)
        .json(&swap_params)
        .send()
        .await
        .context("Failed to get Jupiter swap instructions for sell")?;
    
    if !swap_response.status().is_success() {
        let error_text = swap_response.text().await?;
        return Err(anyhow!("Jupiter swap API error for sell: {}", error_text));
    }
    
    let swap: SwapResponse = swap_response.json().await
        .context("Failed to parse Jupiter swap response for sell")?;
    
    let tx_data = swap.swap_transaction;
    
    // 3. Execute the swap transaction
    let rpc_client = RpcClient::new(rpc_url);
    
    // Deserialize the transaction
    let tx_bytes = base64::decode(&tx_data)
        .context("Failed to decode transaction data for sell")?;
    
    let mut tx: Transaction = bincode::deserialize(&tx_bytes)
        .context("Failed to deserialize transaction for sell")?;
    
    // Sign the transaction
    tx.try_partial_sign(&[keypair], rpc_client.get_latest_blockhash()?)
        .context("Failed to sign transaction for sell")?;
    
    // Send the transaction
    debug!("Sending sell transaction...");
    let signature = rpc_client.send_and_confirm_transaction_with_spinner(&tx)
        .context("Failed to send and confirm sell transaction")?;
    
    info!("Sell transaction confirmed: {}", signature);
    
    Ok(signature.to_string())
}

// Get the current price of a token in SOL
pub async fn get_token_price(
    rpc_url: &str,
    mint_address: &Pubkey,
) -> Result<f64> {
    let client = reqwest::Client::new();
    
    // Use Jupiter Price API to get the current price
    let price_url = "https://price.jup.ag/v4/price";
    let price_params = json!({
        "ids": [mint_address.to_string()],
        "vsToken": SOL_MINT,
    });
    
    let price_response = client.get(price_url)
        .query(&price_params)
        .send()
        .await
        .context("Failed to get token price from Jupiter")?;
    
    if !price_response.status().is_success() {
        return Err(anyhow!("Jupiter price API error: {}", price_response.status()));
    }
    
    let price_data: serde_json::Value = price_response.json().await
        .context("Failed to parse Jupiter price response")?;
    
    // Extract the price from the response
    if let Some(data) = price_data["data"].as_object() {
        if let Some(token_data) = data.get(&mint_address.to_string()) {
            if let Some(price) = token_data["price"].as_f64() {
                return Ok(price);
            }
        }
    }
    
    Err(anyhow!("Failed to extract token price from Jupiter response"))
}
