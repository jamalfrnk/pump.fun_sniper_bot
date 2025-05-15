require('dotenv').config();

// Pump.fun program ID from the reference documentation
const PUMPFUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

// SOL mint address for Jupiter transactions
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Predefined token names that might be used by scammers (for safety filtering)
const SUSPICIOUS_TOKEN_NAMES = [
  'sol', 'solana', 'nft', 'coin', 'doge', 'shib', 'pepe', 'musk', 'elon',
  'safe', 'moon', 'inu', 'pump', 'airdrop', 'bot', 'ai', 'gpt', 'token',
  'presale', 'pre-sale', 'pre sale', 'ico', 'initial', 'offering', 'ape',
  'monkey', 'ponzi', 'scam', 'rug', 'gem', '1000x', '100x', 'rugpull'
];

// Structure for application configuration
function loadConfig() {
  // Use the standard RPC URL 
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  
  return {
    rpcUrl: rpcUrl,
    alchemyRpcUrl: process.env.ALCHEMY_RPC_URL,
    alchemyWsUrl: process.env.ALCHEMY_WS_URL,
    buyAmountSol: parseFloat(process.env.BUY_AMOUNT_SOL || '0.1'),
    slippageBps: parseInt(process.env.SLIPPAGE_BPS || '50'),
    profitTarget1: parseFloat(process.env.PROFIT_TARGET_1 || '4.0'),
    profitTarget2: parseFloat(process.env.PROFIT_TARGET_2 || '8.0'),
    sellPercentage1: parseFloat(process.env.SELL_PERCENTAGE_1 || '50.0'),
    sellPercentage2: parseFloat(process.env.SELL_PERCENTAGE_2 || '100.0'),
    logLevel: process.env.LOG_LEVEL || 'info',
    walletPath: process.env.WALLET_PATH,
    walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
    simulationMode: process.env.SIMULATION_MODE === 'true' || false,
    devnetMode: process.env.DEVNET_MODE === 'true' || false,
    pollingIntervalMs: parseInt(process.env.POLLING_INTERVAL_MS || '10000'),
    // For production use
    isPremiumRpc: !!process.env.ALCHEMY_RPC_URL,
  };
}

module.exports = {
  PUMPFUN_PROGRAM_ID,
  SOL_MINT,
  SUSPICIOUS_TOKEN_NAMES,
  loadConfig,
};