use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::sleep;
use anyhow::{Result, Context};
use log::{info, warn, error, debug};
use solana_client::nonblocking::pubsub_client::PubsubClient;
use solana_client::rpc_filter::RpcTransactionLogsFilter;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Signer;
use solana_transaction_status::UiTransactionStatusMeta;

use crate::config::{AppConfig, PUMPFUN_PROGRAM_ID};
use crate::filter::is_token_safe;
use crate::trader::{self, TokenPosition};

// Token information extracted from a new token creation
pub struct NewTokenInfo {
    pub mint_address: Pubkey,
    pub name: String,
    pub symbol: String,
    pub transaction_signature: String,
}

// Start the monitoring process for new Pump.fun tokens
pub async fn start_token_monitor(
    app_config: Arc<AppConfig>,
    active_tokens: Arc<Mutex<Vec<TokenPosition>>>,
) -> Result<()> {
    info!("Starting token monitor for Pump.fun program: {}", PUMPFUN_PROGRAM_ID);
    
    // Parse the Pump.fun program ID
    let program_id = PUMPFUN_PROGRAM_ID.parse::<Pubkey>()
        .context("Invalid Pump.fun program ID")?;
    
    // Start a background task for price monitoring
    let price_monitor_state = app_config.clone();
    let price_monitor_tokens = active_tokens.clone();
    tokio::spawn(async move {
        loop {
            if let Err(e) = monitor_token_prices(price_monitor_state.clone(), price_monitor_tokens.clone()).await {
                error!("Error monitoring token prices: {}", e);
            }
            sleep(Duration::from_secs(5)).await;
        }
    });
    
    // Main subscription loop with retry mechanism
    loop {
        match subscribe_new_tokens(
            &app_config.ws_url,
            program_id,
            app_config.clone(),
            active_tokens.clone()
        ).await {
            Ok(_) => {
                // This should never return Ok unless the subscription is closed
                warn!("Pump.fun subscription ended, reconnecting in 5 seconds...");
            },
            Err(e) => {
                error!("Error in Pump.fun subscription: {}", e);
                error!("Reconnecting in 5 seconds...");
            }
        }
        
        // Delay before retrying subscription
        sleep(Duration::from_secs(5)).await;
    }
}

// Subscribe to Pump.fun program logs for new token creation
async fn subscribe_new_tokens(
    ws_url: &str,
    program_id: Pubkey,
    app_config: Arc<AppConfig>,
    active_tokens: Arc<Mutex<Vec<TokenPosition>>>,
) -> Result<()> {
    // Connect to Solana websocket for logs
    let (pubsub_client, mut receiver) = PubsubClient::logs_subscribe(
        ws_url,
        RpcTransactionLogsFilter::Mentions(program_id.to_string()),
        solana_client::rpc_config::RpcTransactionLogsConfig {
            commitment: Some(solana_sdk::commitment_config::CommitmentConfig::confirmed()),
        },
    ).await.context("Failed to subscribe to Pump.fun program logs")?;
    
    info!("Successfully subscribed to Pump.fun program logs");
    
    // Process incoming log messages
    while let Some(log_notification) = receiver.recv().await {
        let sig = log_notification.value.signature.clone();
        debug!("Received transaction: {}", sig);
        
        // Check if the log corresponds to a 'create' instruction
        if let Some(logs) = &log_notification.value.logs {
            if logs.iter().any(|line| line.contains("create")) {
                info!("Potential new token creation detected! Tx: {}", sig);
                
                // Parse transaction to extract token information
                match extract_token_info_from_logs(logs, sig.clone()).await {
                    Ok(Some(token_info)) => {
                        info!("New token found: {} ({})", token_info.name, token_info.mint_address);
                        
                        // Spawn a task to handle this token (filter, buy, monitor)
                        let task_app_config = app_config.clone();
                        let task_active_tokens = active_tokens.clone();
                        tokio::spawn(async move {
                            if let Err(e) = handle_new_token(token_info, task_app_config, task_active_tokens).await {
                                error!("Failed to process new token: {}", e);
                            }
                        });
                    },
                    Ok(None) => {
                        debug!("Transaction {} did not contain valid token creation", sig);
                    },
                    Err(e) => {
                        warn!("Failed to extract token info from transaction {}: {}", sig, e);
                    }
                }
            }
        }
    }
    
    // Drop the pubsub client to close the connection
    drop(pubsub_client);
    
    Ok(())
}

// Extract token information from transaction logs
async fn extract_token_info_from_logs(
    logs: &[String],
    signature: String,
) -> Result<Option<NewTokenInfo>> {
    // Extract mint address from logs
    // This is a simplified implementation and may need adjustment based on actual log format
    
    let mut mint_address = None;
    let mut name = None;
    let mut symbol = None;
    
    for log in logs {
        // Look for mint address in logs
        if log.contains("mint:") {
            // Parse out the mint address
            if let Some(mint_str) = log.split("mint:").nth(1) {
                let mint_str = mint_str.trim();
                if mint_str.len() >= 32 {  // Simple validation for Solana address length
                    match mint_str.parse::<Pubkey>() {
                        Ok(pubkey) => mint_address = Some(pubkey),
                        Err(_) => continue,
                    }
                }
            }
        }
        
        // Look for token name
        if log.contains("name:") {
            if let Some(name_str) = log.split("name:").nth(1) {
                name = Some(name_str.trim().to_string());
            }
        }
        
        // Look for token symbol
        if log.contains("symbol:") {
            if let Some(symbol_str) = log.split("symbol:").nth(1) {
                symbol = Some(symbol_str.trim().to_string());
            }
        }
    }
    
    // If we couldn't extract the information from logs, try fetching the transaction
    if mint_address.is_none() || name.is_none() || symbol.is_none() {
        // This would require parsing the transaction data
        // For simplicity, we'll use placeholder values when missing
        if mint_address.is_none() {
            warn!("Could not extract mint address from logs");
            return Ok(None);
        }
        
        name = name.or_else(|| Some("Unknown Token".to_string()));
        symbol = symbol.or_else(|| Some("UNKNOWN".to_string()));
    }
    
    Ok(Some(NewTokenInfo {
        mint_address: mint_address.unwrap(),
        name: name.unwrap_or_else(|| "Unknown Token".to_string()),
        symbol: symbol.unwrap_or_else(|| "UNKNOWN".to_string()),
        transaction_signature: signature,
    }))
}

// Handle a new token (filter, buy, monitor)
async fn handle_new_token(
    token_info: NewTokenInfo,
    app_config: Arc<AppConfig>,
    active_tokens: Arc<Mutex<Vec<TokenPosition>>>,
) -> Result<()> {
    // Apply filtering to check if the token is likely to be safe
    if !is_token_safe(&token_info).await {
        warn!("Token {} ({}) did not pass safety filters, skipping", 
              token_info.name, token_info.mint_address);
        return Ok(());
    }
    
    info!("Token {} ({}) passed safety filters, attempting to buy", 
          token_info.name, token_info.mint_address);
    
    // Execute buy order via Jupiter
    match trader::buy_token(
        &app_config.rpc_url,
        &app_config.keypair,
        &token_info.mint_address,
        app_config.buy_amount_sol,
        app_config.slippage_bps,
    ).await {
        Ok(buy_info) => {
            info!("Successfully bought {} ({}) for {} SOL", 
                  token_info.name, token_info.mint_address, buy_info.sol_amount);
            
            // Create a new token position and add to active tokens
            let position = TokenPosition {
                mint_address: token_info.mint_address,
                name: token_info.name.clone(),
                symbol: token_info.symbol.clone(),
                buy_price: buy_info.token_price,
                buy_amount_sol: buy_info.sol_amount,
                token_amount: buy_info.token_amount,
                current_price: buy_info.token_price,
                buy_time: chrono::Utc::now(),
                profit_target_1: app_config.profit_target_1 * buy_info.token_price,
                profit_target_2: app_config.profit_target_2 * buy_info.token_price,
                sold_percentage: 0.0,
                last_updated: chrono::Utc::now(),
                status: "Active".to_string(),
            };
            
            // Add to active tokens
            active_tokens.lock().await.push(position);
            
            Ok(())
        },
        Err(e) => {
            error!("Failed to buy token {} ({}): {}", 
                   token_info.name, token_info.mint_address, e);
            Err(e)
        }
    }
}

// Monitor prices of active tokens and execute sell orders when targets are hit
async fn monitor_token_prices(
    app_config: Arc<AppConfig>,
    active_tokens: Arc<Mutex<Vec<TokenPosition>>>,
) -> Result<()> {
    let mut tokens = active_tokens.lock().await;
    
    // Skip if no active tokens
    if tokens.is_empty() {
        return Ok(());
    }
    
    // Update current prices and check sell targets
    for token in tokens.iter_mut() {
        if token.sold_percentage >= 100.0 {
            // Skip tokens that are fully sold
            continue;
        }
        
        // Update current price via Jupiter API
        match trader::get_token_price(
            &app_config.rpc_url,
            &token.mint_address,
        ).await {
            Ok(current_price) => {
                token.current_price = current_price;
                token.last_updated = chrono::Utc::now();
                
                let price_ratio = current_price / token.buy_price;
                debug!("{} price: {} SOL ({}x)", token.name, current_price, price_ratio);
                
                // Check if price targets are hit
                if token.sold_percentage < app_config.sell_percentage_1 && price_ratio >= app_config.profit_target_1 {
                    info!("First profit target hit for {} ({}x) - selling {}%",
                          token.name, price_ratio, app_config.sell_percentage_1);
                    
                    // Calculate amount to sell
                    let sell_amount = token.token_amount * (app_config.sell_percentage_1 / 100.0);
                    
                    // Execute sell
                    if let Err(e) = trader::sell_token(
                        &app_config.rpc_url,
                        &app_config.keypair,
                        &token.mint_address,
                        sell_amount as u64,
                        app_config.slippage_bps,
                    ).await {
                        error!("Failed to sell {} at first target: {}", token.name, e);
                    } else {
                        token.sold_percentage = app_config.sell_percentage_1;
                        token.status = format!("Sold {}%", token.sold_percentage);
                    }
                } else if token.sold_percentage < app_config.sell_percentage_2 && price_ratio >= app_config.profit_target_2 {
                    info!("Second profit target hit for {} ({}x) - selling remaining",
                          token.name, price_ratio);
                    
                    // Calculate remaining amount to sell
                    let remaining_percentage = app_config.sell_percentage_2 - token.sold_percentage;
                    let sell_amount = token.token_amount * (remaining_percentage / 100.0);
                    
                    // Execute sell
                    if let Err(e) = trader::sell_token(
                        &app_config.rpc_url,
                        &app_config.keypair,
                        &token.mint_address,
                        sell_amount as u64,
                        app_config.slippage_bps,
                    ).await {
                        error!("Failed to sell {} at second target: {}", token.name, e);
                    } else {
                        token.sold_percentage = app_config.sell_percentage_2;
                        token.status = "Fully Sold".to_string();
                    }
                }
            },
            Err(e) => {
                warn!("Failed to update price for {}: {}", token.name, e);
            }
        }
    }
    
    Ok(())
}
