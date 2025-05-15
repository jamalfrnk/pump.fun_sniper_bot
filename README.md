# Solana Pump.fun Sniper Bot

A JavaScript-based automated trading bot that detects new token launches on Pump.fun, executes purchases via Jupiter, and implements an automated profit-taking strategy.

## Features

- **Wallet Management**: Securely create, import, and manage Solana wallets.
- **New Token Detection**: Monitor the Pump.fun platform for newly launched tokens in real-time.
- **Safety Filtering**: Apply heuristics to filter out potential scams and rug pulls.
- **Automated Trading**: Execute token purchases and sales via Jupiter Aggregator.
- **Profit Strategy**: Automatically take profits at predefined price targets.
- **Simulation Mode**: Test the bot's logic without making real transactions or hitting RPC limits.
- **Comprehensive Logging**: Detailed activity and performance monitoring.
- **RPC Optimization**: Connection pooling and retry mechanisms to handle rate limits.
- **Devnet Support**: Option to run on Solana devnet for testing.

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

# Operational modes
# Set to true to enable simulation mode (no real transactions)
SIMULATION_MODE=false
# Set to true to use devnet instead of mainnet
DEVNET_MODE=false
# Interval in milliseconds between polling for new tokens
POLLING_INTERVAL_MS=10000
```

## Running the Bot

### Production Mode

For live operation with real transactions on mainnet:

1. **Set up a wallet with SOL funds** - Either create a new wallet or use an existing one by configuring `WALLET_PATH` or `WALLET_PRIVATE_KEY` in your `.env` file

2. **Get premium RPC endpoints** - For reliable operation, get API keys from services like:
   - [Alchemy](https://www.alchemy.com/) - Higher rate limits and reliable connections
   - [Helius](https://helius.xyz/) - Specialized for Solana with good free tier

3. **Configure environment**:
   ```
   # In .env file:
   SIMULATION_MODE=false
   DEVNET_MODE=false
   ALCHEMY_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/YOUR_API_KEY
   ALCHEMY_WS_URL=wss://solana-mainnet.g.alchemy.com/v2/YOUR_API_KEY
   ```

4. **Start the bot**:
   ```bash
   node src/index.js
   ```

### Simulation Mode

To run in simulation mode without making real transactions (helps avoid RPC rate limits during testing):

```
# In .env file, set:
SIMULATION_MODE=true

# Then run:
node src/index.js
```

### Testing on Devnet

For testing with devnet tokens before going to mainnet:

```
# In .env file, set:
DEVNET_MODE=true
SIMULATION_MODE=false

# Then run:
node src/index.js
```

### Operational Flow

The bot will:
1. Initialize and load configuration settings
2. Set up a wallet (create new or load existing)
3. Connect to Solana and start monitoring Pump.fun for new tokens
4. Filter out potential scam tokens using safety checks
5. Automatically purchase tokens that pass the safety checks
6. Monitor token prices and take profits at the specified targets

### RPC Optimization

The bot implements several strategies to handle Solana's RPC rate limits:

- Connection pooling with multiple endpoints
- Exponential backoff and smart retry logic
- HTTP polling instead of WebSocket subscriptions
- Simulation mode for testing without hitting real RPC endpoints

### Advanced Configuration

- In simulation mode, the bot simulates token discoveries and price movements
- Adjust the `POLLING_INTERVAL_MS` to control how frequently the bot checks for new tokens
- Use `DEVNET_MODE=true` for testing with Solana devnet

## Production Warning

When running in production mode:

- **Use a dedicated wallet** with only the funds you're willing to risk
- **Start with small amounts** (0.05-0.1 SOL per trade) until you're confident in the bot's performance
- **Monitor the bot regularly** to ensure it's operating as expected
- **Keep your private keys secure** and never share them with anyone

## Disclaimer

This bot is for educational purposes only. Trading cryptocurrencies involves significant risk, and you should never invest money you cannot afford to lose. The author takes no responsibility for financial losses incurred through the use of this software.

Please be aware that:

1. Pump.fun tokens are extremely high-risk investments
2. Many tokens may be scams or "rug pulls"
3. The bot's safety filters cannot detect all potential scams
4. Market conditions can change rapidly and unpredictably
5. Technical issues with Solana RPC nodes may affect the bot's performance
6. The bot may miss opportunities or make unprofitable trades

## License

ISC