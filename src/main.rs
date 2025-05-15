use std::env;
use anyhow::Result;
use log::{info, error, LevelFilter};
use dotenv::dotenv;
use solana_sdk::signature::{Keypair, Signer};
use solana_client::rpc_client::RpcClient;

// Constants
const PUMPFUN_PROGRAM_ID: &str = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    env_logger::Builder::new()
        .filter_level(LevelFilter::Info)
        .format_timestamp_secs()
        .init();

    // Load environment variables
    dotenv().ok();
    
    // Get RPC URL with fallback
    let rpc_url = env::var("SOLANA_RPC_URL")
        .unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".to_string());
    
    info!("Starting Solana Pump.fun Sniper Bot");
    info!("Using RPC URL: {}", rpc_url);
    
    // Initialize wallet
    let keypair = generate_or_load_wallet()?;
    info!("Wallet loaded: {}", keypair.pubkey());

    // Get wallet balance
    let rpc_client = RpcClient::new(&rpc_url);
    match rpc_client.get_balance(&keypair.pubkey()) {
        Ok(balance) => {
            let sol_balance = balance as f64 / 1_000_000_000.0;
            info!("SOL Balance: {} SOL", sol_balance);
        },
        Err(e) => {
            error!("Failed to get wallet balance: {}", e);
        }
    }
    
    info!("Bot initialized successfully");
    info!("Pump.fun program ID: {}", PUMPFUN_PROGRAM_ID);
    
    // In a full implementation, we would start the token monitor here
    
    Ok(())
}

// Generate a new wallet or load an existing one
fn generate_or_load_wallet() -> Result<Keypair> {
    // First try to load from private key in environment
    if let Ok(private_key) = env::var("WALLET_PRIVATE_KEY") {
        return get_keypair_from_base58(&private_key);
    }
    
    // Then try to load from file path
    if let Ok(path) = env::var("WALLET_PATH") {
        if std::path::Path::new(&path).exists() {
            return Ok(solana_sdk::signature::read_keypair_file(&path)?);
        }
    }
    
    // Otherwise, generate a new keypair
    let keypair = Keypair::new();
    info!("Generated new wallet: {}", keypair.pubkey());
    
    // Display private key in base58 for backup
    let private_key = bs58::encode(&keypair.to_bytes()[..32]).into_string();
    info!("IMPORTANT: Save this private key as backup: {}", private_key);
    
    Ok(keypair)
}

// Convert a base58 private key string to a Keypair
fn get_keypair_from_base58(private_key: &str) -> Result<Keypair> {
    let bytes = bs58::decode(private_key)
        .into_vec()?;
    
    if bytes.len() != 64 && bytes.len() != 32 {
        return Err(anyhow::anyhow!(
            "Invalid private key length. Expected 32 or 64 bytes, got {}",
            bytes.len()
        ));
    }
    
    // If we have just the private key (32 bytes), expand to full keypair format
    let keypair_bytes = if bytes.len() == 32 {
        let mut full_bytes = [0u8; 64];
        full_bytes[..32].copy_from_slice(&bytes);
        // The public key will be derived when the Keypair is constructed
        full_bytes
    } else {
        let mut full_bytes = [0u8; 64];
        full_bytes.copy_from_slice(&bytes);
        full_bytes
    };
    
    Ok(Keypair::from_bytes(&keypair_bytes)?)
}