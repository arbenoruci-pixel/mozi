# Crypto Trading Signal Server with Multi-Strategy System

## Overview

This project is a cryptocurrency trading signal generator offering a 5-day free trial for Telegram users. It provides automated BUY/SELL/HOLD alerts based on three distinct trading strategies (Day Trading, Swing Trading, Long-Term). These strategies analyze 12 cryptocurrencies using Exponential Moving Average (EMA) crossovers combined with Relative Strength Index (RSI) filtering, each optimized for different risk tolerances and trading styles. A Telegram bot (@arben_crypto_bot) delivers strategy-specific alerts. The system runs three independent paper trading challenges simultaneously: Day Trading ($1000, 1 week), Swing Trading ($1000, 1 month), and Long-Term ($1000, 6 months), each with a public dashboard for complete transparency.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions

- **Dashboard Multi-Strategy View**: Features tab-based filtering for "All Strategies", "Day Trading", "Swing Trading", and "Long-Term". Displays all 36 strategy-symbol combinations with color-coded strategy badges and real-time signal updates every 30 seconds.
- **Multi-Strategy Paper Trading Dashboard**: A public dashboard (`/paper-trading.html`) with tab-based navigation for all three trading strategies. Each tab displays portfolio value, total return, win rate, open positions with unrealized P/L, and complete trade history for that specific strategy. The dashboard auto-refreshes every 10 seconds, showing real-time performance across all $3000 in total capital. The main signals dashboard (`/dashboard.html`) includes a prominent link for easy access.

### Technical Implementations

- **Multi-Strategy Trading System**: Implements three strategies (Day Trading, Swing Trading, Long-Term) with distinct timeframes, EMA parameters, and RSI thresholds. Users can select their preferred strategy via Telegram commands.
- **Alert System**: Employs a per-strategy signal tracking mechanism (`lastSignals`) to detect changes to BUY or SELL signals across all strategies and symbols. Alerts are broadcast to active users subscribed to the matching strategy, with a 100ms delay between messages to manage Telegram rate limits.
- **Multi-Portfolio Paper Trading System**: Runs three independent trading bots simultaneously, each with $1000 starting capital and distinct strategies:
  - **Day Trading Bot**: 1-week challenge using "short" plan (fast EMAs), 2% stop-loss, 5% take-profit
  - **Swing Trading Bot**: 1-month challenge using "medium" plan (medium EMAs), 3% stop-loss, 8% take-profit  
  - **Long-Term Bot**: 6-month challenge using "long" plan (slow EMAs), 5% stop-loss, 15% take-profit
  
  Each bot maintains separate portfolio files (`paper-portfolio-{strategy}.json`), manages position sizing (10% per trade, max 3 concurrent), and performs mark-to-market valuations. **All trades from all three bots are broadcast to Telegram in real-time**, with notifications clearly identifying which strategy executed the trade.
  
  **Stop-Loss/Take-Profit Logic**: Implements robust validation to prevent zero-width stops. The system uses ATR-based dynamic stop-loss/take-profit calculations with automatic fallback to percentage-based values when ATR is too small (< 0.1% of price). Enforces minimum distances (0.5% from entry) and validates SL < entry < TP for LONG positions. Exit conditions require actual realized profit/loss (>0.1%) before triggering to prevent floating-point comparison issues and instant exits.
- **User Management**: A file-based system (`users.json`) stores user data for trial management, subscription tracking, and referral codes, avoiding the need for a traditional database for simplicity. New users receive an automatic 5-day trial, and an admin API is available for upgrading plans.

### Feature Specifications

- **Signal Generation**: Stateless signal generation calculates technical indicators on-demand using fresh data.
- **Strategy Selection**: Users can select or change their preferred trading strategy via Telegram commands.
- **Automated Alerts**: Strategy-specific BUY/SELL/HOLD alerts are sent to users.
- **Multi-Strategy Paper Trading**: Three independent trading bots running simultaneously, each demonstrating a different strategy with automated trade execution. Real-time Telegram notifications for all trades (BUY/SELL) identify which strategy (Day/Swing/Long) executed, allowing public tracking of all three challenges: 1 week for day trading, 1 month for swing trading, and 6 months for long-term investing.
- **Trial System**: 5-day free trial for new users with automated expiry notifications.

### System Design Choices

- **Backend**: Node.js/Express REST API server.
- **Data Source**: CryptoCompare free API for historical cryptocurrency price data.
- **Signal Logic**: EMA crossover (e.g., Fast EMA 5, Slow EMA 13 for Day Trading) combined with RSI filtering (e.g., <75 for BUY, >25 for SELL for Day Trading).
- **Data Persistence**: File-based storage for user data (`users.json`) and paper trading portfolios (`paper-portfolio-day.json`, `paper-portfolio-swing.json`, `paper-portfolio-long.json`), with each strategy maintaining independent state for isolated performance tracking.
- **Data Layer**: Multi-timeframe OHLC cache (1m, 5m, 15m, 1h) with historical backfill via KuCoin REST API (100% free, no API key required). DataFeedManager fetches complete historical coverage on startup (500 1m, 500 5m, 400 15m, 300 1h bars per symbol). KuCoin WebSocket provides real-time price updates for all 12 symbols via single `/market/ticker:all` subscription. CoinGecko batch fallback (all 12 symbols in one call) every 2 minutes for redundancy. Disk persistence prevents re-fetching on restart. WebSocket token renewal every 12 hours ensures long-term stability.
- **Error Handling**: Robust error handling for file I/O, Telegram API interactions, and external API calls to ensure system resilience.
- **Performance**: Delays implemented for API calls (e.g., 500ms for CryptoCompare, 100ms for Telegram messages) and dashboard refreshes to adhere to rate limits and manage load.
- **Health Checks**: Ultra-fast middleware (first in chain) detects Cloud Run health check requests and responds with 200 OK in <10ms, before any background initialization or expensive operations.

## External Dependencies

### Third-Party APIs

- **CryptoCompare API (`min-api.cryptocompare.com`)**: Used for fetching hourly historical cryptocurrency price data via the `/data/v2/histohour` endpoint. No authentication is required for the free tier.
- **Telegram Bot API**: Utilized for sending automated trading alerts and handling user commands via the `node-telegram-bot-api` library.

### NPM Libraries

- **express**: Core web server framework.
- **cors**: Enables cross-origin requests.
- **node-fetch**: HTTP client for external API calls, primarily for CryptoCompare.
- **technicalindicators**: Library for calculating technical analysis indicators like EMA and RSI.
- **node-telegram-bot-api**: Wrapper for the Telegram Bot API.

### Infrastructure Requirements

- **Node.js**: Runtime environment.
- **Telegram Bot Token**: Required for bot functionality.
- **Internet Connectivity**: For external API access.
- **Deployment**: Configured for Reserved VM deployment (not Autoscale) due to continuous background tasks (paper trading bots check every 60s, signal monitoring every 10 minutes). Cloud Run health checks handled by ultra-fast middleware responding in <10ms.