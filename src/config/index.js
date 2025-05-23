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
  // Prioritize Alchemy RPC URL if available, fallback to standard RPC
  const rpcUrl = process.env.ALCHEMY_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  
  return {
    rpcUrl: rpcUrl,
    alchemyRpcUrl: process.env.ALCHEMY_RPC_URL,
    alchemyWsUrl: process.env.ALCHEMY_WS_URL,
    buyAmountSol: parseFloat(process.env.BUY_AMOUNT_SOL || '0.1'),
    slippageBps: parseInt(process.env.SLIPPAGE_BPS || '200'),
    
    // Multiple profit targets for more sophisticated exit strategy
    profitTarget1: parseFloat(process.env.PROFIT_TARGET_1 || '1.3'),
    profitTarget2: parseFloat(process.env.PROFIT_TARGET_2 || '2.0'),
    profitTarget3: parseFloat(process.env.PROFIT_TARGET_3 || '3.0'),
    profitTarget4: parseFloat(process.env.PROFIT_TARGET_4 || '4.0'),
    profitTarget5: parseFloat(process.env.PROFIT_TARGET_5 || '8.0'),
    
    // Corresponding sell percentages for each target
    sellPercentage1: parseFloat(process.env.SELL_PERCENTAGE_1 || '15.0'),
    sellPercentage2: parseFloat(process.env.SELL_PERCENTAGE_2 || '50.0'),
    sellPercentage3: parseFloat(process.env.SELL_PERCENTAGE_3 || '15.0'), 
    sellPercentage4: parseFloat(process.env.SELL_PERCENTAGE_4 || '15.0'),
    sellPercentage5: parseFloat(process.env.SELL_PERCENTAGE_5 || '5.0'),
    logLevel: process.env.LOG_LEVEL || 'info',
    walletPath: process.env.WALLET_PATH,
    walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
    simulationMode: process.env.SIMULATION_MODE === 'true' || false,
    devnetMode: process.env.DEVNET_MODE === 'true' || false,
    pollingIntervalMs: parseInt(process.env.POLLING_INTERVAL_MS || '10000'),
    // Security module settings
    enableCpiChecks: process.env.ENABLE_CPI_CHECKS !== 'false',
    enableMintAuthorityChecks: process.env.ENABLE_MINT_AUTHORITY_CHECKS !== 'false',
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