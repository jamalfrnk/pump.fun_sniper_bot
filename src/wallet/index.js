const { Keypair } = require('@solana/web3.js');
const { Connection, PublicKey } = require('@solana/web3.js');
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
    const connection = new Connection(rpcUrl);
    const balance = await connection.getBalance(publicKey);
    // Convert lamports to SOL
    const solBalance = balance / 1_000_000_000;
    return solBalance;
  } catch (error) {
    logger.error(`Failed to get wallet balance: ${error.message}`);
    throw error;
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
    const connection = new Connection(rpcUrl);
    
    // Get token accounts owned by the wallet
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPubkey, {
      mint: mintPubkey,
    });
    
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

module.exports = {
  getOrCreateKeypair,
  getKeypairFromBase58,
  getWalletBalance,
  getTokenBalance
};