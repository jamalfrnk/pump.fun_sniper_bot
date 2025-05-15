use std::env;
use anyhow::Result;
use dotenv::dotenv;

fn main() -> Result<()> {
    // Load environment variables
    dotenv().ok();
    
    // Print a message
    println!("Solana Bot Test");
    println!("Environment variables loaded: {}", env::var("RUST_LOG").unwrap_or_else(|_| "None".to_string()));
    
    Ok(())
}
