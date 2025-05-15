use std::env;
use std::path::Path;
use std::fs;
use std::io::{self, Write};
use solana_sdk::signature::{Keypair, Signer, read_keypair_file};
use anyhow::{Result, Context};
use log::{info, warn};
use bs58;

// Get the trading keypair from environment or generate a new one
pub fn get_trading_keypair() -> Result<Keypair> {
    // First try to load from private key in environment
    if let Ok(private_key) = env::var("WALLET_PRIVATE_KEY") {
        return get_keypair_from_base58(&private_key)
            .context("Failed to parse private key from environment variable");
    }
    
    // Then try to load from file path
    if let Ok(path) = env::var("WALLET_PATH") {
        if Path::new(&path).exists() {
            return read_keypair_file(&path)
                .context("Failed to read keypair file")
                .map_err(|e| anyhow::anyhow!(e));
        }
    }
    
    // Otherwise, ask user if they want to generate new keypair
    println!("No wallet found. Generate a new wallet? [y/N]: ");
    io::stdout().flush()?;
    
    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    let input = input.trim().to_lowercase();
    
    if input == "y" || input == "yes" {
        let keypair = Keypair::new();
        let pubkey = keypair.pubkey();
        info!("Generated new wallet: {}", pubkey);
        
        // Save to disk with proper permissions
        let outfile = "sniper-wallet.json";
        fs::write(outfile, keypair.to_bytes())
            .context("Unable to write keypair")?;
        info!("Saved new keypair to {}", outfile);
        
        // Also display private key in base58 for backup
        let private_key = bs58::encode(&keypair.to_bytes()[..32]).into_string();
        info!("IMPORTANT: Save this private key as backup: {}", private_key);
        
        return Ok(keypair);
    } else {
        return Err(anyhow::anyhow!("No wallet provided. Please set WALLET_PRIVATE_KEY or WALLET_PATH environment variable."));
    }
}

// Convert a base58 private key string to a Keypair
fn get_keypair_from_base58(private_key: &str) -> Result<Keypair> {
    let bytes = bs58::decode(private_key)
        .into_vec()
        .context("Invalid private key format")?;
    
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

// Get balance of wallet in SOL
pub async fn get_wallet_balance(rpc_url: &str, pubkey: &solana_sdk::pubkey::Pubkey) -> Result<f64> {
    let rpc_client = solana_client::rpc_client::RpcClient::new(rpc_url);
    
    let balance = rpc_client.get_balance(pubkey)
        .context("Failed to get wallet balance")?;
    
    // Convert lamports to SOL
    let sol_balance = balance as f64 / 1_000_000_000.0;
    
    Ok(sol_balance)
}

// Get token balance for a specific mint
pub async fn get_token_balance(
    rpc_url: &str, 
    wallet_pubkey: &solana_sdk::pubkey::Pubkey, 
    mint_pubkey: &solana_sdk::pubkey::Pubkey
) -> Result<u64> {
    let rpc_client = solana_client::rpc_client::RpcClient::new(rpc_url);
    
    // Get the associated token account
    let token_account = spl_associated_token_account::get_associated_token_address(
        wallet_pubkey,
        mint_pubkey,
    );
    
    // Check if the token account exists
    match rpc_client.get_token_account_balance(&token_account) {
        Ok(balance) => {
            Ok(balance.ui_amount_string.parse::<f64>()? as u64)
        },
        Err(_) => {
            // If the account doesn't exist, return 0
            Ok(0)
        }
    }
}
