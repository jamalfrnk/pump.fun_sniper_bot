require('dotenv').config();

// Pump.fun program ID from the reference documentation
const PUMPFUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

// SOL mint address for Jupiter transactions
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Structure for application configuration
function loadConfig() {
  return {
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    buyAmountSol: parseFloat(process.env.BUY_AMOUNT_SOL || '0.1'),
    slippageBps: parseInt(process.env.SLIPPAGE_BPS || '50'),
    profitTarget1: parseFloat(process.env.PROFIT_TARGET_1 || '4.0'),
    profitTarget2: parseFloat(process.env.PROFIT_TARGET_2 || '8.0'),
    sellPercentage1: parseFloat(process.env.SELL_PERCENTAGE_1 || '50.0'),
    sellPercentage2: parseFloat(process.env.SELL_PERCENTAGE_2 || '100.0'),
    logLevel: process.env.LOG_LEVEL || 'info',
    walletPath: process.env.WALLET_PATH,
    walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
  };
}

module.exports = {
  PUMPFUN_PROGRAM_ID,
  SOL_MINT,
  loadConfig,
};