const { PublicKey, Connection } = require('@solana/web3.js');
const logger = require('../utils/logger');
const { PUMPFUN_PROGRAM_ID } = require('../config');
const { isTokenSafe } = require('../filter');
const trader = require('../trader');
const { getHttpConnection, getWsConnection, retryRpc } = require('../utils/rpc');

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
  
  // Check if we're in simulation mode
  if (config.simulationMode) {
    logger.info('🔬 Running in SIMULATION MODE - no real transactions will be executed');
    await startSimulationMode(config, keypair, activeTokens);
    return;
  }
  
  // Main subscription loop with retry mechanism
  let consecutiveErrors = 0;
  
  while (true) {
    try {
      // Use HTTP connection for program monitoring instead of WebSocket
      // This avoids WebSocket connection issues
      const connection = getHttpConnection('confirmed');
      await monitorProgramViaHttp(connection, programId, config, keypair, activeTokens);
      consecutiveErrors = 0; // Reset error counter on success
    } catch (error) {
      consecutiveErrors++;
      logger.error(`Error in Pump.fun subscription: ${error.message}`);
      
      // Calculate backoff time based on consecutive errors (max 60 seconds)
      const backoffTime = Math.min(5000 * Math.pow(1.5, consecutiveErrors - 1), 60000);
      logger.error(`Reconnecting in ${(backoffTime/1000).toFixed(1)} seconds... (attempt ${consecutiveErrors})`);
      
      // If we have persistent errors, rotate through RPC endpoints more aggressively
      if (consecutiveErrors > 3) {
        logger.warn('Persistent connection issues detected, rotating through RPC endpoints...');
      }
    }
    
    // Delay before retrying subscription with exponential backoff
    const retryDelay = Math.min(5000 * Math.pow(1.5, consecutiveErrors - 1), 60000);
    await new Promise(resolve => setTimeout(resolve, retryDelay));
  }
}

/**
 * Run the bot in simulation mode to avoid hitting RPC limits
 * @param {Object} config - Application configuration
 * @param {Keypair} keypair - Wallet keypair
 * @param {Array} activeTokens - Array to store active token positions
 */
async function startSimulationMode(config, keypair, activeTokens) {
  logger.info('Starting simulation mode - periodically generating fake token events');
  
  // Generate some test tokens
  const testTokens = [
    {
      name: 'SuperCoin',
      symbol: 'SUPER',
      mintAddress: 'JBu1AL4obBcCMqKBBxhpWCNUt136ijcuMZLFvTP7iWdB'
    },
    {
      name: 'MoonRocket',
      symbol: 'MOON', 
      mintAddress: '5RpUwQ8wtdPCZHhu6MERp2RGrpobsbZ6MH5dDHkUjs2'
    },
    {
      name: 'TradeFi Protocol',
      symbol: 'TRFI',
      mintAddress: 'AVKnHiay8LsEeieL8QpwZ4SDH5iuRjpWbPc9uAg9UHwN'
    },
    {
      name: 'DeFi Alliance',
      symbol: 'DEFA', 
      mintAddress: 'AZ1jmdqQzC3jKJfuVzVqd25J8pYRCz9qRFY67TGxABz'
    },
    {
      name: 'ElonDoge Token',
      symbol: 'ELOND',
      mintAddress: 'E1onDXmKLA8JEVREsR5h8sdwv5dhoGXXP2XYYSXy9MeZ'
    }
  ];
  
  let index = 0;
  
  // Simulate token discovery at random intervals
  while (true) {
    // Create a delay between 20 and 60 seconds for "discovering" new tokens
    const delay = config.pollingIntervalMs + Math.floor(Math.random() * 40000);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    // Get next token in rotation
    const token = testTokens[index % testTokens.length];
    index++;
    
    // Create a simulated token info object
    const tokenInfo = new NewTokenInfo(
      token.mintAddress,
      token.name,
      token.symbol,
      'simulation-' + Date.now().toString()
    );
    
    logger.info(`[SIMULATION] New token found: ${tokenInfo.name} (${tokenInfo.symbol})`);
    
    // Process with normal flow
    try {
      // Filter using real filtering logic
      if (!await isTokenSafe(tokenInfo)) {
        logger.warn(`[SIMULATION] Token ${tokenInfo.name} did not pass safety filters, skipping`);
        continue;
      }
      
      logger.info(`[SIMULATION] Token ${tokenInfo.name} passed safety filters, simulating buy`);
      
      // Simulate a buy (no real transaction)
      const simulatedBuyInfo = {
        solAmount: config.buyAmountSol,
        tokenAmount: Math.floor(Math.random() * 100000) + 10000, // Random amount between 10k-110k
        tokenPrice: config.buyAmountSol / (Math.floor(Math.random() * 100000) + 10000),
        transactionSignature: 'sim-' + Date.now().toString()
      };
      
      // Create token position
      const position = new TokenPosition(
        tokenInfo.mintAddress,
        tokenInfo.name,
        tokenInfo.symbol,
        simulatedBuyInfo.tokenPrice,
        simulatedBuyInfo.solAmount,
        simulatedBuyInfo.tokenAmount
      );
      
      // Set profit targets (as multipliers)
      position.profitTarget1 = config.profitTarget1;
      position.profitTarget2 = config.profitTarget2;
      
      // Add to active tokens
      activeTokens.push(position);
      
      logger.info(`[SIMULATION] Successfully bought ${tokenInfo.name} for ${simulatedBuyInfo.solAmount} SOL`);
      logger.info(`[SIMULATION] Token added to monitoring with profit targets: ${position.profitTarget1}x and ${position.profitTarget2}x`);
      
      // Simulate price evolution for this token
      simulatePriceMovement(position, config);
    } catch (error) {
      logger.error(`[SIMULATION] Error processing token: ${error.message}`);
    }
  }
}

/**
 * Simulate price movements for a token over time
 * @param {TokenPosition} position - Token position
 * @param {Object} config - Application configuration
 */
function simulatePriceMovement(position, config) {
  // Generate a random trend pattern
  const trendType = Math.floor(Math.random() * 4);
  let priceMultiplier = 1.0;
  
  // Schedule price updates at random intervals
  const scheduleUpdate = () => {
    const interval = Math.floor(Math.random() * 30000) + 5000; // 5-35 seconds
    
    setTimeout(() => {
      // Update the price based on the trend pattern
      switch (trendType) {
        case 0: // Pump and dump
          if (priceMultiplier < 10) {
            priceMultiplier *= 1.2; // Fast increase
          } else {
            priceMultiplier *= 0.7; // Fast decrease after peak
          }
          break;
        case 1: // Steady rise
          priceMultiplier *= 1.05 + (Math.random() * 0.1);
          break;
        case 2: // Initial pump then flat
          if (priceMultiplier < 4) {
            priceMultiplier *= 1.15;
          } else {
            priceMultiplier *= 0.99 + (Math.random() * 0.03); // Slight fluctuation
          }
          break;
        case 3: // Volatility
          if (Math.random() > 0.5) {
            priceMultiplier *= 1.1 + (Math.random() * 0.1);
          } else {
            priceMultiplier *= 0.9 + (Math.random() * 0.05);
          }
          break;
      }
      
      // Update token price
      const newPrice = position.buyPrice * priceMultiplier;
      position.currentPrice = newPrice;
      position.lastUpdated = new Date();
      
      // Log significant price changes
      if (Math.abs(priceMultiplier - position.lastReportedMultiplier) > 0.5 || !position.lastReportedMultiplier) {
        position.lastReportedMultiplier = priceMultiplier;
        logger.info(`[SIMULATION] ${position.name} price: ${newPrice.toFixed(8)} SOL (${priceMultiplier.toFixed(2)}x)`);
      }
      
      // Continue updating if token is still active and multiplier is positive
      if (position.soldPercentage < 100 && priceMultiplier > 0.1) {
        scheduleUpdate();
      } else {
        logger.info(`[SIMULATION] Stopped price updates for ${position.name} - token fully sold or price too low`);
      }
    }, interval);
  };
  
  // Start the price updates
  position.lastReportedMultiplier = 1.0;
  scheduleUpdate();
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
  // Get a connection from the WebSocket pool
  const connection = getWsConnection('confirmed');
  
  logger.info('Connecting to Solana websocket for Pump.fun logs...');
  
  try {
    // Set up subscription with account filters to reduce data volume
    const filters = [
      { dataSize: 165 }, // Filter for typical Pump.fun account size
    ];
    
    const subscriptionConfig = {
      commitment: 'confirmed',
      filters
    };

    // Set up the subscription with retry logic
    const subscriptionId = await retryRpc(
      () => connection.onProgramAccountChange(
        programId,
        async (keyedAccountInfo, ctx) => {
          try {
            // Get a different connection for transaction queries
            const httpConn = getHttpConnection('confirmed');
            
            // Extract account key and slot from the change
            const accountKey = keyedAccountInfo.accountId.toBase58();
            const slot = ctx.slot.toString();
            
            logger.debug(`Received program account change for ${accountKey} at slot ${slot}`);
            
            // Get the recent signatures for this account
            const signatures = await retryRpc(
              () => httpConn.getSignaturesForAddress(keyedAccountInfo.accountId, { limit: 1 }),
              { description: 'getSignaturesForAddress' }
            );
            
            if (!signatures || signatures.length === 0) {
              logger.debug(`No recent signatures for account ${accountKey}`);
              return;
            }
            
            const signature = signatures[0].signature;
            
            // Get the transaction details
            const transaction = await retryRpc(
              () => httpConn.getTransaction(signature),
              { description: 'getTransaction' }
            );
            
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
        subscriptionConfig
      ),
      { description: 'onProgramAccountChange subscription' }
    );
    
    logger.info(`Successfully subscribed to Pump.fun program logs, subscription ID: ${subscriptionId}`);
    
    // Keep the subscription alive
    return new Promise(() => {
      // This promise never resolves unless the subscription is explicitly closed
      // We'll handle reconnection in the main loop if needed
    });
  } catch (error) {
    logger.error(`Failed to subscribe to program: ${error.message}`);
    throw error;
  }
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
      // In simulation mode, we don't need to update prices here as they're
      // handled by the simulation functions
      if (!config.simulationMode) {
        // Update current price via Jupiter API
        const currentPrice = await trader.getTokenPrice(
          config.rpcUrl,
          token.mintAddress
        );
        
        token.currentPrice = currentPrice;
        token.lastUpdated = new Date();
      }
      
      const priceRatio = token.currentPrice / token.buyPrice;
      
      // Only log non-simulation prices or significant simulation changes
      if (!config.simulationMode || (Math.abs(priceRatio - (token.lastReportedRatio || 0)) > 0.5)) {
        logger.debug(`${token.name} price: ${token.currentPrice.toFixed(8)} SOL (${priceRatio.toFixed(2)}x)`);
        token.lastReportedRatio = priceRatio;
      }
      
      // Check if price targets are hit
      if (token.soldPercentage < config.sellPercentage1 && priceRatio >= config.profitTarget1) {
        logger.info(`First profit target hit for ${token.name} (${priceRatio.toFixed(2)}x) - selling ${config.sellPercentage1}%`);
        
        // Calculate amount to sell
        const sellAmount = token.tokenAmount * (config.sellPercentage1 / 100);
        
        try {
          if (config.simulationMode) {
            // Simulate sell without making actual transaction
            logger.info(`[SIMULATION] Successfully sold ${config.sellPercentage1}% of ${token.name} at ${priceRatio.toFixed(2)}x profit`);
            const solReceived = sellAmount * token.currentPrice;
            logger.info(`[SIMULATION] Received ${solReceived.toFixed(4)} SOL from sale`);
            
            // Update token status
            token.soldPercentage = config.sellPercentage1;
            token.status = `Sold ${token.soldPercentage}%`;
          } else {
            // Execute real sell
            await trader.sellToken(
              config.rpcUrl,
              keypair,
              token.mintAddress,
              sellAmount,
              config.slippageBps
            );
            
            token.soldPercentage = config.sellPercentage1;
            token.status = `Sold ${token.soldPercentage}%`;
          }
        } catch (error) {
          logger.error(`Failed to sell ${token.name} at first target: ${error.message}`);
        }
      } else if (token.soldPercentage < config.sellPercentage2 && priceRatio >= config.profitTarget2) {
        logger.info(`Second profit target hit for ${token.name} (${priceRatio.toFixed(2)}x) - selling remaining`);
        
        // Calculate remaining amount to sell
        const remainingPercentage = config.sellPercentage2 - token.soldPercentage;
        const sellAmount = token.tokenAmount * (remainingPercentage / 100);
        
        try {
          if (config.simulationMode) {
            // Simulate sell without making actual transaction
            logger.info(`[SIMULATION] Successfully sold remaining ${remainingPercentage}% of ${token.name} at ${priceRatio.toFixed(2)}x profit`);
            const solReceived = sellAmount * token.currentPrice;
            logger.info(`[SIMULATION] Received ${solReceived.toFixed(4)} SOL from sale`);
            
            // Update token status
            token.soldPercentage = config.sellPercentage2;
            token.status = 'Fully Sold';
          } else {
            // Execute real sell
            await trader.sellToken(
              config.rpcUrl,
              keypair,
              token.mintAddress,
              sellAmount,
              config.slippageBps
            );
            
            token.soldPercentage = config.sellPercentage2;
            token.status = 'Fully Sold';
          }
        } catch (error) {
          logger.error(`Failed to sell ${token.name} at second target: ${error.message}`);
        }
      }
    } catch (error) {
      logger.warn(`Failed to update price for ${token.name}: ${error.message}`);
    }
  }
}

/**
 * Monitor the Pump.fun program using HTTP polling instead of WebSocket
 * This is a more reliable alternative to WebSocket subscriptions
 * @param {Connection} connection - Solana connection
 * @param {PublicKey} programId - Pump.fun program ID
 * @param {Object} config - Application configuration
 * @param {Keypair} keypair - Wallet keypair
 * @param {Array} activeTokens - Array to store active token positions
 */
async function monitorProgramViaHttp(connection, programId, config, keypair, activeTokens) {
  logger.info('Starting HTTP polling for Pump.fun program activity...');
  
  // Keep track of the last slot we've seen
  let lastCheckedSlot = 0;
  
  // Use a slower polling interval to avoid rate limits
  const POLL_INTERVAL_MS = 10000; // 10 seconds
  
  // Use a cache to prevent duplicate processing
  const processedSignatures = new Set();
  
  // Keep track of recent accounts to avoid querying the same accounts repeatedly
  const recentAccounts = new Map(); // pubkey -> last checked timestamp
  
  // Main polling loop
  while (true) {
    try {
      // Get latest slot for reference
      const latestSlot = await retryRpc(
        () => connection.getSlot(),
        { description: 'get latest slot', retries: 10 }
      );
      
      if (lastCheckedSlot === 0) {
        // First run, just set the reference point and continue
        lastCheckedSlot = latestSlot;
        logger.info(`Setting initial reference slot to ${lastCheckedSlot}`);
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        continue;
      }
      
      // Use more targeted approach based on recent transactions
      // to avoid expensive getProgramAccounts calls
      
      // Get recent signatures for the program - this is more efficient
      logger.debug(`Checking for activity since slot ${lastCheckedSlot}`);
      let programTransactions;
      
      try {
        // First approach: try getting signatures directly for the program (most efficient)
        programTransactions = await retryRpc(
          () => connection.getSignaturesForAddress(
            programId,
            { limit: 10 }
          ),
          { description: 'get program signatures', retries: 3 }
        );
      } catch (programSigError) {
        logger.debug(`Failed to get program signatures: ${programSigError.message}`);
        
        // Second approach: fall back to a limited getProgramAccounts
        try {
          const programAccounts = await retryRpc(
            () => connection.getProgramAccounts(programId, {
              commitment: 'confirmed',
              dataSlice: { offset: 0, length: 0 }, // Don't fetch account data
              filters: [
                { dataSize: 165 } // Filter by typical size for Pump.fun token accounts
              ],
              withContext: false
            }),
            { description: 'get program accounts efficiently', retries: 3 }
          );
          
          logger.debug(`Retrieved ${programAccounts.length} program account references`);
          
          // Process a limited number of accounts to avoid rate limits
          // Prioritize accounts we haven't checked recently
          const now = Date.now();
          const accountsToCheck = programAccounts
            .filter(account => {
              const pubkeyStr = account.pubkey.toString();
              const lastChecked = recentAccounts.get(pubkeyStr) || 0;
              // Only check accounts we haven't checked in the last minute
              return (now - lastChecked) > 60000;
            })
            .slice(0, 3); // Limit to 3 accounts per poll
            
          programTransactions = [];
          
          // Check each account for activity
          for (const account of accountsToCheck) {
            const pubkeyStr = account.pubkey.toString();
            
            // Record that we're checking this account
            recentAccounts.set(pubkeyStr, now);
            
            // Get signatures for this account
            try {
              const accountSigs = await retryRpc(
                () => connection.getSignaturesForAddress(
                  account.pubkey,
                  { limit: 3 }
                ),
                { description: `get signatures for account ${pubkeyStr.slice(0, 6)}...`, retries: 2 }
              );
              
              if (accountSigs && accountSigs.length > 0) {
                programTransactions.push(...accountSigs);
              }
              
              // Add a small delay between account queries to avoid rate limits
              await new Promise(resolve => setTimeout(resolve, 200));
            } catch (err) {
              logger.debug(`Failed to get signatures for account ${pubkeyStr.slice(0, 6)}...: ${err.message}`);
            }
          }
        } catch (fallbackError) {
          logger.warn(`All RPC methods failed: ${fallbackError.message}`);
          programTransactions = [];
        }
      }
      
      if (!programTransactions || programTransactions.length === 0) {
        logger.debug('No new program transactions found');
        lastCheckedSlot = latestSlot;
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        continue;
      }
      
      // Process each signature
      for (const sigInfo of programTransactions) {
        // Skip already processed signatures
        if (processedSignatures.has(sigInfo.signature) || sigInfo.slot <= lastCheckedSlot) {
          continue;
        }
        
        // Add to processed set
        processedSignatures.add(sigInfo.signature);
        
        // Maintain cache size
        if (processedSignatures.size > 100) {
          const oldest = Array.from(processedSignatures)[0];
          processedSignatures.delete(oldest);
        }
        
        logger.debug(`Checking transaction signature ${sigInfo.signature}`);
        
        // Get the transaction details
        try {
          const transaction = await retryRpc(
            () => connection.getTransaction(sigInfo.signature),
            { description: 'get transaction details', retries: 3 }
          );
          
          if (!transaction) {
            continue;
          }
          
          // Check if this is a token creation transaction
          if (isTokenCreationTransaction(transaction)) {
            logger.info(`Potential new token creation detected! Tx: ${sigInfo.signature}`);
            
            // Extract token information from the transaction
            const tokenInfo = await extractTokenInfoFromTransaction(transaction, sigInfo.signature);
            
            if (tokenInfo) {
              logger.info(`New token found: ${tokenInfo.name} (${tokenInfo.mintAddress})`);
              
              // Handle this token (filter, buy, monitor)
              try {
                await handleNewToken(tokenInfo, config, keypair, activeTokens);
              } catch (error) {
                logger.error(`Failed to process new token: ${error.message}`);
              }
            }
          }
        } catch (txError) {
          logger.debug(`Failed to get transaction ${sigInfo.signature}: ${txError.message}`);
        }
        
        // Add a small delay between transaction requests to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Update the last checked slot
      lastCheckedSlot = latestSlot;
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    } catch (error) {
      logger.error(`Error in HTTP polling: ${error.message}`);
      // Wait before retrying after an error
      await new Promise(resolve => setTimeout(resolve, 5000));
      throw error; // Let the main loop handle reconnection
    }
  }
}

module.exports = {
  startTokenMonitor,
  TokenPosition,
  NewTokenInfo,
  monitorProgramViaHttp
};