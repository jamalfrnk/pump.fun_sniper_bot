const { loadConfig } = require('./config');
const { getOrCreateKeypair, getWalletBalance } = require('./wallet');
const { startTokenMonitor } = require('./monitor');
const logger = require('./utils/logger');

/**
 * Main entry point for the Solana Pump.fun Sniper Bot
 */
async function main() {
  try {
    // Load configuration
    const config = loadConfig();
    logger.info('Starting Solana Pump.fun Sniper Bot');
    
    // Check for simulation/devnet modes
    if (config.simulationMode) {
      logger.info('🔬 Starting in SIMULATION MODE - no real transactions will be executed');
    }
    if (config.devnetMode) {
      logger.info('🧪 Using DEVNET instead of mainnet');
      // Update RPC URL for devnet if needed
      config.rpcUrl = 'https://api.devnet.solana.com';
    }
    
    logger.info(`Using RPC URL: ${config.rpcUrl}`);
    
    // Initialize wallet
    const keypair = getOrCreateKeypair(config);
    logger.info(`Wallet loaded: ${keypair.publicKey.toString()}`);
    
    // Get wallet balance (skip actual RPC call in simulation mode)
    if (config.simulationMode) {
      const simulatedBalance = 2.5; // Simulate having enough SOL
      logger.info(`[SIMULATION] SOL Balance: ${simulatedBalance} SOL (simulated)`);
    } else {
      try {
        const balance = await getWalletBalance(config.rpcUrl, keypair.publicKey);
        logger.info(`SOL Balance: ${balance} SOL`);
        
        if (balance < config.buyAmountSol) {
          logger.warn(`Wallet balance (${balance} SOL) is less than buy amount (${config.buyAmountSol} SOL)`);
          logger.warn('The bot may not be able to execute buy orders with the current settings');
        }
      } catch (error) {
        logger.error(`Failed to get wallet balance: ${error.message}`);
      }
    }
    
    // Print configuration summary
    logger.info('Configuration:');
    logger.info(` - Buy Amount: ${config.buyAmountSol} SOL`);
    logger.info(` - Slippage: ${config.slippageBps} bps`);
    logger.info(` - Profit Targets:`);
    logger.info(`    Target 1: ${config.profitTarget1}x (sell ${config.sellPercentage1}%)`);
    logger.info(`    Target 2: ${config.profitTarget2}x (sell ${config.sellPercentage2}%)`);
    logger.info(`    Target 3: ${config.profitTarget3}x (sell ${config.sellPercentage3}%)`);
    logger.info(`    Target 4: ${config.profitTarget4}x (sell ${config.sellPercentage4}%)`);
    logger.info(`    Target 5: ${config.profitTarget5}x (sell ${config.sellPercentage5}%)`);
    logger.info(` - Exit Strategy: Multi-tiered (${config.sellPercentage1}% + ${config.sellPercentage2}% + ${config.sellPercentage3}% + ${config.sellPercentage4}% + ${config.sellPercentage5}%)`);
    if (config.simulationMode) {
      logger.info(` - Simulation Mode: Enabled`);
    }
    if (config.devnetMode) {
      logger.info(` - Network: Devnet`);
    } else {
      logger.info(` - Network: Mainnet`);
    }
    
    // Array to store active token positions
    const activeTokens = [];
    
    // Start the token monitor
    await startTokenMonitor(config, keypair, activeTokens);
  } catch (error) {
    logger.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  console.error(`Unhandled error: ${error.message}`);
  process.exit(1);
});