const { Connection, PublicKey } = require('@solana/web3.js');
const logger = require('./logger');

// Define a pool of RPC endpoints for production use
// Prioritize premium endpoints that allow getProgramAccounts and have higher rate limits
const HTTP_RPC_ENDPOINTS = [
  process.env.ALCHEMY_RPC_URL,                       // Premium Alchemy endpoint (primary)
  'https://api.mainnet-beta.solana.com',             // Official but limited (backup)
  'https://solana-api.projectserum.com',             // Backup
  'https://rpc.ankr.com/solana',                     // Good general purpose endpoint
  'https://solana-mainnet.public.blastapi.io',       // Decent free tier
].filter(Boolean); // Filter out any undefined values

// Define a pool of WebSocket endpoints for production use
const WS_RPC_ENDPOINTS = [
  process.env.ALCHEMY_WS_URL,                        // Premium Alchemy WebSocket (primary)
  'wss://api.mainnet-beta.solana.com',               // Official WebSocket (backup)
  'wss://rpc.ankr.com/solana/ws',                    // Good alternate
  'wss://solana-mainnet.public.blastapi.io',         // Another option
].filter(Boolean); // Filter out any undefined values

// Track which endpoint we're on
let httpIndex = 0;
let wsIndex = 0;

// Track endpoints that have failed with 410 errors
const failedEndpoints = new Set();

/**
 * Get a connection for HTTP requests, rotating through endpoints
 * @param {string} commitment - Commitment level ('confirmed', 'finalized', etc.)
 * @returns {Connection} Solana connection
 */
function getHttpConnection(commitment = 'confirmed') {
  // Filter out endpoints that have failed with 410 errors
  const availableEndpoints = HTTP_RPC_ENDPOINTS.filter(endpoint => !failedEndpoints.has(endpoint));
  
  // If we've exhausted all endpoints, reset the failed set and try again
  if (availableEndpoints.length === 0) {
    logger.warn('All RPC endpoints have failed, resetting failed endpoint tracking');
    failedEndpoints.clear();
    return getHttpConnection(commitment);
  }
  
  // Get next available endpoint
  const url = availableEndpoints[httpIndex % availableEndpoints.length];
  httpIndex++;
  
  logger.debug(`Using HTTP RPC endpoint: ${url}`);
  return new Connection(url, {
    commitment: commitment,
    confirmTransactionInitialTimeout: 60000,
    maxSupportedTransactionVersion: 0
  });
}

/**
 * Get a connection for WebSocket subscriptions, rotating through endpoints
 * @param {string} commitment - Commitment level ('confirmed', 'finalized', etc.)
 * @returns {Connection} Solana connection
 */
function getWsConnection(commitment = 'confirmed') {
  // Filter out endpoints that have failed with 410 errors
  const availableEndpoints = WS_RPC_ENDPOINTS.filter(endpoint => !failedEndpoints.has(endpoint));
  
  // If we've exhausted all endpoints, reset the failed set and try again
  if (availableEndpoints.length === 0) {
    logger.warn('All WebSocket endpoints have failed, resetting failed endpoint tracking');
    failedEndpoints.clear();
    return getWsConnection(commitment);
  }
  
  // Get next available endpoint
  const url = availableEndpoints[wsIndex % availableEndpoints.length];
  wsIndex++;
  
  logger.debug(`Using WebSocket RPC endpoint: ${url}`);
  return new Connection(url, {
    commitment: commitment,
    confirmTransactionInitialTimeout: 60000,
    maxSupportedTransactionVersion: 0
  });
}

/**
 * Check if an error is a rate limit error or a disabled endpoint error
 * @param {Error} err - Error to check
 * @returns {boolean} True if this is a rate limit error
 */
function isRateLimitError(err) {
  const errStr = err.message || JSON.stringify(err);
  return errStr.includes('429') || 
         errStr.includes('Too Many Requests') || 
         errStr.includes('rate limit') ||
         errStr.includes('timeout') ||
         errStr.includes('call or parameters have been disabled') ||
         errStr.includes('410') ||
         errStr.includes('503');
}

/**
 * Extract the endpoint URL from a Solana connection
 * @param {Connection} connection - Solana connection
 * @returns {string} Endpoint URL
 */
function getConnectionEndpoint(connection) {
  try {
    return connection._rpcEndpoint || 'unknown-endpoint';
  } catch (err) {
    return 'unknown-endpoint';
  }
}

/**
 * Mark an endpoint as failed
 * @param {Connection} connection - Solana connection
 */
function markEndpointFailed(connection) {
  const endpoint = getConnectionEndpoint(connection);
  if (endpoint !== 'unknown-endpoint') {
    failedEndpoints.add(endpoint);
    logger.warn(`Marked endpoint as failed: ${endpoint}`);
    
    // If we have too many failed endpoints, reset some to ensure we don't run out
    if (failedEndpoints.size >= HTTP_RPC_ENDPOINTS.length - 1) {
      // Keep the most recently failed endpoint, reset the others
      const mostRecent = endpoint;
      failedEndpoints.clear();
      failedEndpoints.add(mostRecent);
      logger.info('Reset failed endpoints list to prevent exhaustion');
    }
  }
}

/**
 * Retry an RPC call with exponential backoff
 * @param {Function} fn - Function to call
 * @param {Object} options - Retry options
 * @returns {Promise<any>} Result of the function
 */
async function retryRpc(fn, {
  retries = 5,
  delayMs = 500,
  factor = 2,
  description = 'RPC call',
  connection = null
} = {}) {
  try {
    return await fn();
  } catch (err) {
    // Check for rate limiting or disabled endpoint
    if (isRateLimitError(err) && retries > 0) {
      // If we have a connection reference, mark its endpoint as failed
      if (connection) {
        markEndpointFailed(connection);
      }
      
      // Log the retry attempt
      logger.debug(`Server responded with rate limit error. Retrying after ${delayMs}ms delay...`);
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delayMs));
      
      // Try again with increased delay
      return retryRpc(fn, {
        retries: retries - 1,
        delayMs: delayMs * factor,
        factor,
        description,
        connection
      });
    }
    
    // If we're out of retries or it's not a retryable error, throw
    logger.error(`Failed ${description} after retries: ${err.message}`);
    throw err;
  }
}

module.exports = {
  getHttpConnection,
  getWsConnection,
  retryRpc
};