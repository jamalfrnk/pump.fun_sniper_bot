const { Keypair, Connection, PublicKey } = require('@solana/web3.js');
const bs58 = require('bs58');
const fs = require('fs');
const logger = require('../utils/logger');

/**
 * Generate a new keypair or load an existing one from env or file
 * @returns {Keypair} Solana keypair
 */
function getOrCreateKeypair(config) {
  try {
    // Try to load from private key in environment variables
    if (config.walletPrivateKey) {
      return getKeypairFromBase58(config.walletPrivateKey);
    }

    // Try to load from file path
    if (config.walletPath && fs.existsSync(config.walletPath)) {
      const keyfileData = JSON.parse(fs.readFileSync(config.walletPath, 'utf-8'));
      return Keypair.fromSecretKey(Uint8Array.from(keyfileData));
    }

    // Otherwise, generate a new keypair
    const keypair = Keypair.generate();
    const publicKey = keypair.publicKey.toString();
    logger.info(`Generated new wallet: ${publicKey}`);

    // Save keypair to file
    const keypairFile = 'sniper-wallet.json';
    fs.writeFileSync(keypairFile, JSON.stringify(Array.from(keypair.secretKey)));
    logger.info(`Saved new keypair to ${keypairFile}`);

    // Display private key in base58 for backup
    const secretKey = Buffer.from(keypair.secretKey).toString('base64');
    logger.info(`IMPORTANT: Save this private key as backup (base64 encoded): ${secretKey}`);

    return keypair;
  } catch (error) {
    logger.error(`Error creating/loading keypair: ${error.message}`);
    throw error;
  }
}

/**
 * Convert a base58 private key string to a Keypair
 * @param {string} privateKey - Base58 encoded private key
 * @returns {Keypair} Solana keypair
 */
function getKeypairFromBase58(privateKey) {
  try {
    // For compatibility with bs58 encoding/decoding issues,
    // we'll assume privateKey could be base64 or raw
    let secretKey;
    try {
      // Try base64 first
      secretKey = Buffer.from(privateKey, 'base64');
    } catch (e) {
      // If that fails, try direct use
      secretKey = Buffer.from(privateKey);
    }
    
    // Validate key length
    if (secretKey.length !== 64 && secretKey.length !== 32) {
      throw new Error(`Invalid private key length. Expected 32 or 64 bytes, got ${secretKey.length}`);
    }
    
    return Keypair.fromSecretKey(secretKey);
  } catch (error) {
    logger.error(`Failed to parse private key: ${error.message}`);
    throw error;
  }
}

/**
 * Get wallet balance in SOL
 * @param {string} rpcUrl - Solana RPC URL
 * @param {PublicKey} publicKey - Wallet public key
 * @returns {Promise<number>} Balance in SOL
 */
async function getWalletBalance(rpcUrl, publicKey) {
  try {
    // Import RPC utilities
    const { getHttpConnection, retryRpc } = require('../utils/rpc');
    
    // Get a connection from the pool
    const connection = getHttpConnection('confirmed');
    
    // Use retry mechanism for balance query
    const balance = await retryRpc(
      () => connection.getBalance(publicKey),
      { description: 'get wallet balance', retries: 7 }
    );
    
    // Convert lamports to SOL
    const solBalance = balance / 1_000_000_000;
    return solBalance;
  } catch (error) {
    logger.error(`Failed to get wallet balance: ${error.message}`);
    // Return 0 instead of throwing to allow the app to continue
    return 0;
  }
}

/**
 * Get token balance for a specific mint
 * @param {string} rpcUrl - Solana RPC URL
 * @param {PublicKey} walletPubkey - Wallet public key
 * @param {PublicKey} mintPubkey - Token mint public key
 * @returns {Promise<number>} Token balance
 */
async function getTokenBalance(rpcUrl, walletPubkey, mintPubkey) {
  try {
    // Import RPC utilities if not already imported
    const { getHttpConnection, retryRpc } = require('../utils/rpc');
    
    // Get a connection from the pool
    const connection = getHttpConnection('confirmed');
    
    // Get token accounts owned by the wallet with retry
    const tokenAccounts = await retryRpc(
      () => connection.getParsedTokenAccountsByOwner(walletPubkey, {
        mint: mintPubkey,
      }),
      { description: 'get token accounts', retries: 5 }
    );
    
    // If no token accounts, return 0
    if (tokenAccounts.value.length === 0) {
      return 0;
    }
    
    // Return balance from the first account
    const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
    return balance;
  } catch (error) {
    logger.error(`Failed to get token balance: ${error.message}`);
    return 0; // Return 0 on error
  }
}

/**
 * Request an airdrop of SOL from the Solana devnet (for testing only)
 * @param {string} rpcUrl - Solana RPC URL (must be devnet)
 * @param {PublicKey} publicKey - Wallet public key
 * @param {number} amountSol - Amount of SOL to airdrop
 * @returns {Promise<string>} Transaction signature
 */
async function requestDevnetAirdrop(rpcUrl, publicKey, amountSol = 1) {
  try {
    // Only allow this on devnet
    if (!rpcUrl.includes('devnet')) {
      throw new Error('Airdrops are only available on Solana devnet');
    }
    
    // Import RPC utilities if not already imported
    const { getHttpConnection, retryRpc } = require('../utils/rpc');
    
    // Get a connection from the pool
    const connection = getHttpConnection('confirmed');
    const lamports = Math.floor(amountSol * 1_000_000_000);
    
    logger.info(`Requesting ${amountSol} SOL airdrop to ${publicKey.toString()}`);
    
    // Request airdrop with retry
    const signature = await retryRpc(
      () => connection.requestAirdrop(publicKey, lamports),
      { description: 'request airdrop', retries: 3 }
    );
    
    // Confirm transaction with retry
    await retryRpc(
      () => connection.confirmTransaction(signature),
      { description: 'confirm airdrop transaction', retries: 10 }
    );
    
    logger.info(`Airdrop successful: ${signature}`);
    return signature;
  } catch (error) {
    logger.error(`Airdrop failed: ${error.message}`);
    throw error;
  }
}

module.exports = {
  getOrCreateKeypair,
  getKeypairFromBase58,
  getWalletBalance,
  getTokenBalance,
  requestDevnetAirdrop
};