const { PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const axios = require('axios');
const logger = require('../utils/logger');
const { SOL_MINT } = require('../config');
const { getHttpConnection, retryRpc } = require('../utils/rpc');

/**
 * Buy a token using Jupiter API
 * @param {string} rpcUrl - Solana RPC URL
 * @param {Keypair} keypair - Wallet keypair
 * @param {string} mintAddress - Token mint address
 * @param {number} amountSol - Amount of SOL to spend
 * @param {number} slippageBps - Slippage tolerance in basis points
 * @returns {Promise<Object>} Buy information
 */
async function buyToken(rpcUrl, keypair, mintAddress, amountSol, slippageBps) {
  try {
    const walletPublicKey = keypair.publicKey.toString();
    
    logger.info(`Preparing to buy token ${mintAddress} with ${amountSol} SOL`);
    
    // Convert SOL amount to lamports
    const amountLamports = Math.floor(amountSol * 1_000_000_000);
    
    // 1. Get a swap quote from Jupiter with retry
    const quoteUrl = 'https://quote-api.jup.ag/v6/quote';
    const quoteParams = {
      inputMint: SOL_MINT,
      outputMint: mintAddress,
      amount: amountLamports,
      slippageBps: slippageBps,
      swapMode: 'ExactIn',
      maxAccounts: 15
    };
    
    logger.debug('Requesting Jupiter quote...');
    const quoteResponse = await retryRpc(
      async () => axios.get(quoteUrl, { params: quoteParams }),
      { description: 'Jupiter quote' }
    );
    
    if (!quoteResponse.data) {
      throw new Error('Failed to get quote from Jupiter');
    }
    
    const quote = quoteResponse.data;
    const outputAmount = quote.outAmount;
    const pricePerToken = amountSol / (outputAmount / 1_000_000); // Assuming 6 decimals for Pump tokens
    
    logger.info(`Quote received: ${amountSol} SOL -> ${outputAmount / 1_000_000} tokens, price: ${pricePerToken} SOL per token`);
    
    // 2. Get swap instructions from Jupiter with retry
    const swapUrl = 'https://quote-api.jup.ag/v6/swap';
    const swapParams = {
      quoteResponse: quote,
      userPublicKey: walletPublicKey,
      wrapAndUnwrapSol: true,
      feeAccount: walletPublicKey
    };
    
    logger.debug('Requesting Jupiter swap instructions...');
    const swapResponse = await retryRpc(
      async () => axios.post(swapUrl, swapParams),
      { description: 'Jupiter swap instructions' }
    );
    
    if (!swapResponse.data) {
      throw new Error('Failed to get swap instructions from Jupiter');
    }
    
    const { swapTransaction } = swapResponse.data;
    
    // 3. Execute the swap transaction with a connection from our pool
    const connection = getHttpConnection('confirmed');
    
    // Deserialize the transaction
    const txBuffer = Buffer.from(swapTransaction, 'base64');
    const tx = Transaction.from(txBuffer);
    
    // Sign and send transaction with retry
    logger.debug('Sending buy transaction...');
    const signature = await retryRpc(
      async () => sendAndConfirmTransaction(connection, tx, [keypair]),
      { description: 'buy transaction confirmation' }
    );
    
    logger.info(`Buy transaction confirmed: ${signature}`);
    
    // Return buy information
    return {
      solAmount: amountSol,
      tokenAmount: outputAmount / 1_000_000, // Assuming 6 decimals
      tokenPrice: pricePerToken,
      transactionSignature: signature
    };
  } catch (error) {
    logger.error(`Failed to buy token: ${error.message}`);
    throw error;
  }
}

/**
 * Sell a token using Jupiter API
 * @param {string} rpcUrl - Solana RPC URL
 * @param {Keypair} keypair - Wallet keypair
 * @param {string} mintAddress - Token mint address
 * @param {number} tokenAmount - Amount of tokens to sell
 * @param {number} slippageBps - Slippage tolerance in basis points
 * @returns {Promise<string>} Transaction signature
 */
async function sellToken(rpcUrl, keypair, mintAddress, tokenAmount, slippageBps) {
  try {
    const walletPublicKey = keypair.publicKey.toString();
    
    logger.info(`Preparing to sell ${tokenAmount} tokens of mint ${mintAddress}`);
    
    // Convert token amount to smallest unit (assuming 6 decimals)
    const tokenAmountSmallest = Math.floor(tokenAmount * 1_000_000);
    
    // 1. Get a swap quote from Jupiter (token -> SOL) with retry
    const quoteUrl = 'https://quote-api.jup.ag/v6/quote';
    const quoteParams = {
      inputMint: mintAddress,
      outputMint: SOL_MINT,
      amount: tokenAmountSmallest,
      slippageBps: slippageBps,
      swapMode: 'ExactIn',
      maxAccounts: 15
    };
    
    logger.debug('Requesting Jupiter quote for sell...');
    const quoteResponse = await retryRpc(
      async () => axios.get(quoteUrl, { params: quoteParams }),
      { description: 'Jupiter quote for sell' }
    );
    
    if (!quoteResponse.data) {
      throw new Error('Failed to get quote from Jupiter for sell');
    }
    
    const quote = quoteResponse.data;
    const solOutput = quote.outAmount / 1_000_000_000; // Convert from lamports to SOL
    
    logger.info(`Sell quote received: ${tokenAmount} tokens -> ${solOutput} SOL`);
    
    // 2. Get swap instructions from Jupiter with retry
    const swapUrl = 'https://quote-api.jup.ag/v6/swap';
    const swapParams = {
      quoteResponse: quote,
      userPublicKey: walletPublicKey,
      wrapAndUnwrapSol: true,
      feeAccount: walletPublicKey
    };
    
    logger.debug('Requesting Jupiter swap instructions for sell...');
    const swapResponse = await retryRpc(
      async () => axios.post(swapUrl, swapParams),
      { description: 'Jupiter swap instructions for sell' }
    );
    
    if (!swapResponse.data) {
      throw new Error('Failed to get swap instructions from Jupiter for sell');
    }
    
    const { swapTransaction } = swapResponse.data;
    
    // 3. Execute the swap transaction with a connection from our pool
    const connection = getHttpConnection('confirmed');
    
    // Deserialize the transaction
    const txBuffer = Buffer.from(swapTransaction, 'base64');
    const tx = Transaction.from(txBuffer);
    
    // Sign and send transaction with retry
    logger.debug('Sending sell transaction...');
    const signature = await retryRpc(
      async () => sendAndConfirmTransaction(connection, tx, [keypair]),
      { description: 'sell transaction confirmation' }
    );
    
    logger.info(`Sell transaction confirmed: ${signature}`);
    
    return signature;
  } catch (error) {
    logger.error(`Failed to sell token: ${error.message}`);
    throw error;
  }
}

/**
 * Get the current price of a token in SOL
 * @param {string} rpcUrl - Solana RPC URL
 * @param {string} mintAddress - Token mint address
 * @returns {Promise<number>} Token price in SOL
 */
async function getTokenPrice(rpcUrl, mintAddress) {
  try {
    // Use Jupiter Price API to get the current price with retry
    const priceUrl = 'https://price.jup.ag/v4/price';
    const priceParams = {
      ids: [mintAddress],
      vsToken: SOL_MINT
    };
    
    const priceResponse = await retryRpc(
      async () => axios.get(priceUrl, { params: priceParams }),
      { 
        description: 'Jupiter price API',
        retries: 7,  // Use more retries for price checks
        delayMs: 300  // Shorter initial delay for price checks
      }
    );
    
    if (!priceResponse.data) {
      throw new Error('Failed to get price from Jupiter');
    }
    
    const priceData = priceResponse.data;
    
    // Extract the price from the response
    if (priceData.data && priceData.data[mintAddress]) {
      return priceData.data[mintAddress].price;
    }
    
    throw new Error('Failed to extract token price from Jupiter response');
  } catch (error) {
    logger.error(`Failed to get token price: ${error.message}`);
    throw error;
  }
}

module.exports = {
  buyToken,
  sellToken,
  getTokenPrice
};