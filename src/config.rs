use std::env;
use anyhow::{Result, Context};
use dotenv::dotenv;
use solana_sdk::signature::Keypair;

// Pump.fun program ID from the reference documentation
pub const PUMPFUN_PROGRAM_ID: &str = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

// Structure for application configuration
pub struct Config {
    pub rpc_url: String,
    pub ws_url: String,
    pub buy_amount_sol: f64,
    pub slippage_bps: u64,
    pub profit_target_1: f64,
    pub profit_target_2: f64,
    pub sell_percentage_1: f64,
    pub sell_percentage_2: f64,
}

// Application state that combines configuration and runtime components
pub struct AppConfig {
    pub rpc_url: String,
    pub ws_url: String,
    pub keypair: Keypair,
    pub buy_amount_sol: f64,
    pub slippage_bps: u64,
    pub profit_target_1: f64,
    pub profit_target_2: f64,
    pub sell_percentage_1: f64,
    pub sell_percentage_2: f64,
}

// Load configuration from environment variables
pub fn load_config() -> Result<Config> {
    // Try to load .env file if it exists
    let _ = dotenv();
    
    // Get RPC URL with fallback
    let rpc_url = env::var("SOLANA_RPC_URL")
        .unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".to_string());
    
    // Construct WebSocket URL from RPC URL by replacing http with ws
    let ws_url = if rpc_url.starts_with("https://") {
        rpc_url.replace("https://", "wss://")
    } else if rpc_url.starts_with("http://") {
        rpc_url.replace("http://", "ws://")
    } else {
        // Default to mainnet WebSocket if RPC URL doesn't have expected prefix
        "wss://api.mainnet-beta.solana.com".to_string()
    };
    
    // Get trade parameters with defaults
    let buy_amount_sol = env::var("BUY_AMOUNT_SOL")
        .unwrap_or_else(|_| "0.1".to_string())
        .parse::<f64>()
        .context("Invalid BUY_AMOUNT_SOL value")?;
        
    let slippage_bps = env::var("SLIPPAGE_BPS")
        .unwrap_or_else(|_| "50".to_string())
        .parse::<u64>()
        .context("Invalid SLIPPAGE_BPS value")?;
        
    // Profit targets (multiples of purchase price)
    let profit_target_1 = env::var("PROFIT_TARGET_1")
        .unwrap_or_else(|_| "4.0".to_string())
        .parse::<f64>()
        .context("Invalid PROFIT_TARGET_1 value")?;
        
    let profit_target_2 = env::var("PROFIT_TARGET_2")
        .unwrap_or_else(|_| "8.0".to_string())
        .parse::<f64>()
        .context("Invalid PROFIT_TARGET_2 value")?;
        
    // Percentage to sell at each target (0-100)
    let sell_percentage_1 = env::var("SELL_PERCENTAGE_1")
        .unwrap_or_else(|_| "50.0".to_string())
        .parse::<f64>()
        .context("Invalid SELL_PERCENTAGE_1 value")?;
        
    let sell_percentage_2 = env::var("SELL_PERCENTAGE_2")
        .unwrap_or_else(|_| "100.0".to_string())
        .parse::<f64>()
        .context("Invalid SELL_PERCENTAGE_2 value")?;
    
    Ok(Config {
        rpc_url,
        ws_url,
        buy_amount_sol,
        slippage_bps,
        profit_target_1,
        profit_target_2,
        sell_percentage_1,
        sell_percentage_2,
    })
}

// RPC client configuration (separate from app config)
pub struct SolanaRpcConfig {
    pub client: solana_client::rpc_client::RpcClient,
}

impl SolanaRpcConfig {
    pub fn new(rpc_url: &str) -> Self {
        let client = solana_client::rpc_client::RpcClient::new_with_commitment(
            rpc_url.to_string(),
            solana_sdk::commitment_config::CommitmentConfig::confirmed(),
        );
        SolanaRpcConfig { client }
    }
}
