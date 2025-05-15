# Solana Pump.fun Sniper Bot

A JavaScript-based automated trading bot that detects new token launches on Pump.fun, executes purchases via Jupiter, and implements an automated profit-taking strategy.

## Features

- **Wallet Management**: Securely create, import, and manage Solana wallets.
- **New Token Detection**: Monitor the Pump.fun platform for newly launched tokens in real-time.
- **Safety Filtering**: Apply heuristics to filter out potential scams and rug pulls.
- **Automated Trading**: Execute token purchases and sales via Jupiter Aggregator.
- **Profit Strategy**: Automatically take profits at predefined price targets.
- **Logging**: Comprehensive logging for monitoring bot activity and performance.

## Architecture

The bot is comprised of the following components:

1. **Wallet Management**: Handling keypair generation, loading, and balance checks.
2. **Pump.fun Monitor**: Subscribing to Pump.fun's on-chain program to detect new tokens.
3. **Scam Filter**: Applying safety checks to avoid scams and rug pulls.
4. **Trading Module**: Executing token swaps via Jupiter Aggregator API.
5. **Price Monitoring**: Tracking token prices and executing sell orders at targets.

## Configuration

Create a `.env` file with the following settings:

```
# Solana RPC Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Wallet Configuration
# Either set WALLET_PATH to a keypair file path
# WALLET_PATH=/path/to/your/keypair.json
# Or set WALLET_PRIVATE_KEY to a base58-encoded private key
# WALLET_PRIVATE_KEY=your_base58_encoded_private_key

# Trading Configuration
BUY_AMOUNT_SOL=0.1
SLIPPAGE_BPS=50

# Profit Targets
PROFIT_TARGET_1=4.0  # 4x initial price
PROFIT_TARGET_2=8.0  # 8x initial price

# Sell Percentages (0-100)
SELL_PERCENTAGE_1=50.0  # Sell 50% at first target
SELL_PERCENTAGE_2=100.0  # Sell remaining at second target

# Logging level (info, debug, warn, error)
LOG_LEVEL=info
```

## Running the Bot

To run the bot, use the following command:

```
node src/index.js
```

The bot will:
1. Initialize and load configuration settings
2. Set up a wallet (create new or load existing)
3. Connect to Solana and start monitoring Pump.fun for new tokens
4. Automatically purchase tokens that pass the safety checks
5. Monitor token prices and take profits at the specified targets

## Disclaimer

This bot is for educational purposes only. Trading cryptocurrencies involves significant risk, and you should never invest money you cannot afford to lose. The author takes no responsibility for financial losses incurred through the use of this software.

## License

ISC