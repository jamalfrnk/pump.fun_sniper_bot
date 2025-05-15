const { Connection, PublicKey } = require('@solana/web3.js');
const logger = require('../utils/logger');
const { PUMPFUN_PROGRAM_ID } = require('../config');
const { isTokenSafe } = require('../filter');
const trader = require('../trader');

/**
 * Token information extracted from a new token creation
 */
class NewTokenInfo {
  constructor(mintAddress, name, symbol, transactionSignature) {
    this.mintAddress = mintAddress;
    this.name = name;
    this.symbol = symbol;
    this.transactionSignature = transactionSignature;
  }
}

/**
 * Token position representing a token we've bought
 */
class TokenPosition {
  constructor(mintAddress, name, symbol, buyPrice, buyAmountSol, tokenAmount) {
    this.mintAddress = mintAddress;
    this.name = name;
    this.symbol = symbol;
    this.buyPrice = buyPrice;
    this.buyAmountSol = buyAmountSol;
    this.tokenAmount = tokenAmount;
    this.currentPrice = buyPrice;
    this.buyTime = new Date();
    this.profitTarget1 = null;  // Will be set after construction
    this.profitTarget2 = null;  // Will be set after construction
    this.soldPercentage = 0;
    this.lastUpdated = new Date();
    this.status = 'Active';
  }
}

/**
 * Start monitoring for new Pump.fun tokens
 * @param {Object} config - Application configuration
 * @param {Keypair} keypair - Wallet keypair
 * @param {Array} activeTokens - Array to store active token positions
 */
async function startTokenMonitor(config, keypair, activeTokens) {
  logger.info(`Starting token monitor for Pump.fun program: ${PUMPFUN_PROGRAM_ID}`);
  
  const programId = new PublicKey(PUMPFUN_PROGRAM_ID);
  
  // Start a background task for price monitoring
  startPriceMonitoring(config, keypair, activeTokens);
  
  // Main subscription loop with retry mechanism
  while (true) {
    try {
      await subscribeToNewTokens(config.rpcUrl, programId, config, keypair, activeTokens);
    } catch (error) {
      logger.error(`Error in Pump.fun subscription: ${error.message}`);
      logger.error('Reconnecting in 5 seconds...');
    }
    
    // Delay before retrying subscription
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

/**
 * Subscribe to Pump.fun program logs for new token creation
 * @param {string} rpcUrl - Solana RPC URL
 * @param {PublicKey} programId - Pump.fun program ID
 * @param {Object} config - Application configuration
 * @param {Keypair} keypair - Wallet keypair
 * @param {Array} activeTokens - Array to store active token positions
 */
async function subscribeToNewTokens(rpcUrl, programId, config, keypair, activeTokens) {
  const connection = new Connection(rpcUrl, 'confirmed');
  
  logger.info('Connecting to Solana websocket for Pump.fun logs...');
  
  // Set up the subscription
  const subscriptionId = connection.onProgramAccountChange(
    programId,
    async (accountInfo, context) => {
      try {
        // Extract the transaction signature from the context
        const signature = context.slot.toString();
        logger.debug(`Received program account change at slot ${signature}`);
        
        // Get the transaction details
        const transaction = await connection.getTransaction(signature);
        
        if (!transaction) {
          logger.debug(`Transaction ${signature} not found or not confirmed yet`);
          return;
        }
        
        // Check if this is a token creation transaction
        if (isTokenCreationTransaction(transaction)) {
          logger.info(`Potential new token creation detected! Tx: ${signature}`);
          
          // Extract token information from the transaction
          const tokenInfo = await extractTokenInfoFromTransaction(transaction, signature);
          
          if (tokenInfo) {
            logger.info(`New token found: ${tokenInfo.name} (${tokenInfo.mintAddress})`);
            
            // Handle this token (filter, buy, monitor)
            handleNewToken(tokenInfo, config, keypair, activeTokens).catch(error => {
              logger.error(`Failed to process new token: ${error.message}`);
            });
          }
        }
      } catch (error) {
        logger.error(`Error processing program account change: ${error.message}`);
      }
    },
    'confirmed'
  );
  
  logger.info(`Successfully subscribed to Pump.fun program logs, subscription ID: ${subscriptionId}`);
  
  // Keep the subscription alive
  return new Promise(() => {
    // This promise never resolves unless the subscription is explicitly closed
    // We'll handle reconnection in the main loop if needed
  });
}

/**
 * Check if a transaction is a token creation transaction
 * @param {Object} transaction - Transaction object
 * @returns {boolean} True if this is a token creation transaction
 */
function isTokenCreationTransaction(transaction) {
  // This is a simplified check and would need more detailed implementation
  // based on the actual program instruction format
  
  // Check if the transaction has instructions to the Pump.fun program
  const hasInstructionsToProgram = transaction.transaction.message.instructions.some(
    instruction => instruction.programId.toString() === PUMPFUN_PROGRAM_ID
  );
  
  // Check log messages for 'create' or similar keywords
  const hasCreateLogs = transaction.meta && 
                       transaction.meta.logMessages && 
                       transaction.meta.logMessages.some(log => log.includes('create'));
  
  return hasInstructionsToProgram && hasCreateLogs;
}

/**
 * Extract token information from a transaction
 * @param {Object} transaction - Transaction object
 * @param {string} signature - Transaction signature
 * @returns {NewTokenInfo|null} Token information or null if not a valid token creation
 */
async function extractTokenInfoFromTransaction(transaction, signature) {
  // This is a simplified implementation and would need to be adapted to the actual
  // data format in Pump.fun's transactions
  
  try {
    // Look for the mint address in the transaction
    let mintAddress = null;
    let name = 'Unknown Token';
    let symbol = 'UNKNOWN';
    
    // Example: Extract from logs
    if (transaction.meta && transaction.meta.logMessages) {
      for (const log of transaction.meta.logMessages) {
        // Look for mint address in logs
        if (log.includes('mint:')) {
          const mintStr = log.split('mint:')[1].trim();
          if (mintStr && mintStr.length >= 32) {
            try {
              mintAddress = new PublicKey(mintStr);
            } catch (error) {
              continue;
            }
          }
        }
        
        // Look for token name
        if (log.includes('name:')) {
          name = log.split('name:')[1].trim();
        }
        
        // Look for token symbol
        if (log.includes('symbol:')) {
          symbol = log.split('symbol:')[1].trim();
        }
      }
    }
    
    // If we couldn't extract the mint address, return null
    if (!mintAddress) {
      logger.warn('Could not extract mint address from transaction');
      return null;
    }
    
    return new NewTokenInfo(
      mintAddress.toString(),
      name,
      symbol,
      signature
    );
  } catch (error) {
    logger.error(`Error extracting token info: ${error.message}`);
    return null;
  }
}

/**
 * Handle a new token (filter, buy, monitor)
 * @param {NewTokenInfo} tokenInfo - Token information
 * @param {Object} config - Application configuration
 * @param {Keypair} keypair - Wallet keypair
 * @param {Array} activeTokens - Array to store active token positions
 */
async function handleNewToken(tokenInfo, config, keypair, activeTokens) {
  // Apply filtering to check if the token is likely to be safe
  if (!await isTokenSafe(tokenInfo)) {
    logger.warn(`Token ${tokenInfo.name} (${tokenInfo.mintAddress}) did not pass safety filters, skipping`);
    return;
  }
  
  logger.info(`Token ${tokenInfo.name} (${tokenInfo.mintAddress}) passed safety filters, attempting to buy`);
  
  try {
    // Execute buy order via Jupiter
    const buyInfo = await trader.buyToken(
      config.rpcUrl,
      keypair,
      tokenInfo.mintAddress,
      config.buyAmountSol,
      config.slippageBps
    );
    
    logger.info(`Successfully bought ${tokenInfo.name} (${tokenInfo.mintAddress}) for ${buyInfo.solAmount} SOL`);
    
    // Create a new token position and add to active tokens
    const position = new TokenPosition(
      tokenInfo.mintAddress,
      tokenInfo.name,
      tokenInfo.symbol,
      buyInfo.tokenPrice,
      buyInfo.solAmount,
      buyInfo.tokenAmount
    );
    
    // Set profit targets
    position.profitTarget1 = config.profitTarget1 * buyInfo.tokenPrice;
    position.profitTarget2 = config.profitTarget2 * buyInfo.tokenPrice;
    
    // Add to active tokens
    activeTokens.push(position);
  } catch (error) {
    logger.error(`Failed to buy token ${tokenInfo.name} (${tokenInfo.mintAddress}): ${error.message}`);
    throw error;
  }
}

/**
 * Start monitoring prices of active tokens and executing sell orders
 * @param {Object} config - Application configuration
 * @param {Keypair} keypair - Wallet keypair
 * @param {Array} activeTokens - Array of active token positions
 */
async function startPriceMonitoring(config, keypair, activeTokens) {
  logger.info('Starting price monitoring for active tokens');
  
  // Run price monitoring in a loop
  setInterval(async () => {
    try {
      await monitorTokenPrices(config, keypair, activeTokens);
    } catch (error) {
      logger.error(`Error monitoring token prices: ${error.message}`);
    }
  }, 5000); // Check prices every 5 seconds
}

/**
 * Monitor prices of active tokens and execute sell orders when targets are hit
 * @param {Object} config - Application configuration
 * @param {Keypair} keypair - Wallet keypair
 * @param {Array} activeTokens - Array of active token positions
 */
async function monitorTokenPrices(config, keypair, activeTokens) {
  // Skip if no active tokens
  if (activeTokens.length === 0) {
    return;
  }
  
  // Update current prices and check sell targets
  for (const token of activeTokens) {
    if (token.soldPercentage >= 100) {
      // Skip tokens that are fully sold
      continue;
    }
    
    try {
      // Update current price via Jupiter API
      const currentPrice = await trader.getTokenPrice(
        config.rpcUrl,
        token.mintAddress
      );
      
      token.currentPrice = currentPrice;
      token.lastUpdated = new Date();
      
      const priceRatio = currentPrice / token.buyPrice;
      logger.debug(`${token.name} price: ${currentPrice} SOL (${priceRatio}x)`);
      
      // Check if price targets are hit
      if (token.soldPercentage < config.sellPercentage1 && priceRatio >= config.profitTarget1) {
        logger.info(`First profit target hit for ${token.name} (${priceRatio}x) - selling ${config.sellPercentage1}%`);
        
        // Calculate amount to sell
        const sellAmount = token.tokenAmount * (config.sellPercentage1 / 100);
        
        try {
          // Execute sell
          await trader.sellToken(
            config.rpcUrl,
            keypair,
            token.mintAddress,
            sellAmount,
            config.slippageBps
          );
          
          token.soldPercentage = config.sellPercentage1;
          token.status = `Sold ${token.soldPercentage}%`;
        } catch (error) {
          logger.error(`Failed to sell ${token.name} at first target: ${error.message}`);
        }
      } else if (token.soldPercentage < config.sellPercentage2 && priceRatio >= config.profitTarget2) {
        logger.info(`Second profit target hit for ${token.name} (${priceRatio}x) - selling remaining`);
        
        // Calculate remaining amount to sell
        const remainingPercentage = config.sellPercentage2 - token.soldPercentage;
        const sellAmount = token.tokenAmount * (remainingPercentage / 100);
        
        try {
          // Execute sell
          await trader.sellToken(
            config.rpcUrl,
            keypair,
            token.mintAddress,
            sellAmount,
            config.slippageBps
          );
          
          token.soldPercentage = config.sellPercentage2;
          token.status = 'Fully Sold';
        } catch (error) {
          logger.error(`Failed to sell ${token.name} at second target: ${error.message}`);
        }
      }
    } catch (error) {
      logger.warn(`Failed to update price for ${token.name}: ${error.message}`);
    }
  }
}

module.exports = {
  startTokenMonitor,
  TokenPosition,
  NewTokenInfo
};