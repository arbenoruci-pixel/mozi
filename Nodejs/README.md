# 🚀 Crypto Signal API

Real-time cryptocurrency trading signals using EMA (Exponential Moving Average) crossover strategy combined with RSI (Relative Strength Index) filtering. This API provides BUY/SELL/HOLD recommendations for 6 major cryptocurrencies.

## 📊 Features

- **12 Cryptocurrencies Supported**: BTC, ETH, SOL, XRP, ADA, DOGE, BNB, LTC, MATIC, AVAX, DOT, LINK
- **Dynamic Symbol Management**: Easily add or remove coins by editing `SUPPORTED_SYMBOLS` array
- **Technical Analysis**: EMA (8/21 period) crossover with RSI filtering
- **Real-time Data**: Fetches live price data from CryptoCompare API
- **Auto-Alert System**: Monitors all supported coins every 10 minutes for signal changes
- **Paper Trading**: Simulated trading portfolio to backtest strategies
- **Dynamic Web Dashboard**: Auto-generates cards for all supported coins with live data
- **REST API**: Simple JSON endpoints for easy integration
- **No Authentication Required**: Free CryptoCompare API integration

## 🌐 Production Deployment

**Live URL**: `https://nodejs-arbenoruci.replit.app`

**Deployment Type**: Autoscale (production-ready, auto-scaling)

### ✅ Quick Test Links

Test all endpoints externally:

- **API Dashboard**: [`https://nodejs-arbenoruci.replit.app/`](https://nodejs-arbenoruci.replit.app/)
- **Live Crypto Cards**: [`https://nodejs-arbenoruci.replit.app/dashboard.html`](https://nodejs-arbenoruci.replit.app/dashboard.html) (shows all 12 coins)
- **Supported Symbols**: [`https://nodejs-arbenoruci.replit.app/api/symbols`](https://nodejs-arbenoruci.replit.app/api/symbols)
- **Health Check**: [`https://nodejs-arbenoruci.replit.app/api/health`](https://nodejs-arbenoruci.replit.app/api/health)

**Trading Signals (All 12 Coins):**
- **BTC Signal**: [`https://nodejs-arbenoruci.replit.app/api/signal?symbol=btc`](https://nodejs-arbenoruci.replit.app/api/signal?symbol=btc)
- **ETH Signal**: [`https://nodejs-arbenoruci.replit.app/api/signal?symbol=eth`](https://nodejs-arbenoruci.replit.app/api/signal?symbol=eth)
- **SOL Signal**: [`https://nodejs-arbenoruci.replit.app/api/signal?symbol=sol`](https://nodejs-arbenoruci.replit.app/api/signal?symbol=sol)
- **XRP Signal**: [`https://nodejs-arbenoruci.replit.app/api/signal?symbol=xrp`](https://nodejs-arbenoruci.replit.app/api/signal?symbol=xrp)
- **ADA Signal**: [`https://nodejs-arbenoruci.replit.app/api/signal?symbol=ada`](https://nodejs-arbenoruci.replit.app/api/signal?symbol=ada)
- **DOGE Signal**: [`https://nodejs-arbenoruci.replit.app/api/signal?symbol=doge`](https://nodejs-arbenoruci.replit.app/api/signal?symbol=doge)
- **BNB Signal**: [`https://nodejs-arbenoruci.replit.app/api/signal?symbol=bnb`](https://nodejs-arbenoruci.replit.app/api/signal?symbol=bnb)
- **LTC Signal**: [`https://nodejs-arbenoruci.replit.app/api/signal?symbol=ltc`](https://nodejs-arbenoruci.replit.app/api/signal?symbol=ltc)
- **MATIC Signal**: [`https://nodejs-arbenoruci.replit.app/api/signal?symbol=matic`](https://nodejs-arbenoruci.replit.app/api/signal?symbol=matic)
- **AVAX Signal**: [`https://nodejs-arbenoruci.replit.app/api/signal?symbol=avax`](https://nodejs-arbenoruci.replit.app/api/signal?symbol=avax)
- **DOT Signal**: [`https://nodejs-arbenoruci.replit.app/api/signal?symbol=dot`](https://nodejs-arbenoruci.replit.app/api/signal?symbol=dot)
- **LINK Signal**: [`https://nodejs-arbenoruci.replit.app/api/signal?symbol=link`](https://nodejs-arbenoruci.replit.app/api/signal?symbol=link)

**Other Endpoints:**
- **Paper Trading (Any Coin)**: [`https://nodejs-arbenoruci.replit.app/api/paper?symbol=avax`](https://nodejs-arbenoruci.replit.app/api/paper?symbol=avax)
- **Alert System Status**: [`https://nodejs-arbenoruci.replit.app/api/alerts/status`](https://nodejs-arbenoruci.replit.app/api/alerts/status)

### 📊 Expected Responses

**Health Check:**
```json
{"ok": true, "msg": "healthy"}
```

**Trading Signal Example:**
```json
{
  "ok": true,
  "symbol": "btc",
  "time": "2025-11-11T16:08:39.985Z",
  "signal": "HOLD",
  "price": 103295.11,
  "lastRSI": 32.1,
  "emaFast": 104282.50,
  "emaSlow": 104916.70
}
```

## 🔧 API Endpoints

### Health Check
```
GET /api/health
```
Returns: `{"ok": true, "msg": "healthy"}`

### Get Supported Symbols
```
GET /api/symbols
```
Returns: `{"ok": true, "symbols": [...], "count": 12}`

### Get Trading Signal
```
GET /api/signal?symbol={crypto}
```
**Parameters:**
- `symbol` (string): btc, eth, sol, xrp, ada, doge, bnb, ltc, matic, avax, dot, or link

**Response:**
```json
{
  "ok": true,
  "symbol": "btc",
  "time": "2025-11-11T07:30:00.000Z",
  "signal": "BUY|SELL|HOLD",
  "price": 105190.81,
  "lastRSI": 45.52,
  "emaFast": 105622.80,
  "emaSlow": 105676.29
}
```

### Paper Trading
```
GET /api/paper?symbol={crypto}
```
Returns signal with simulated portfolio status.

### Alert System Status
```
GET /api/alerts/status
```
View auto-alert monitoring status and last signals.

### Check Signals Now
```
POST /api/alerts/check-now
```
Manually trigger signal check (returns current signals).

### Test Telegram Alert
```
GET /api/test-alert
```
Send test notification (requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID).

## 📱 Web Dashboards

### API Dashboard
Visit `/` for a complete API explorer with:
- All available endpoints
- Interactive links to test each route
- Documentation for each crypto supported

### Live Crypto Cards
Visit `/dashboard.html` for:
- **Dynamic grid** showing all 12 supported cryptocurrencies
- Real-time price updates for each coin
- Visual signal indicators (color-coded BUY/SELL/HOLD)
- EMA and RSI values for technical analysis
- Auto-refresh every 30 seconds
- Automatically updates when new coins are added to `SUPPORTED_SYMBOLS`

## 🔔 Telegram Bot & Trial System

### Free 5-Day Trial

All new users who join via Telegram automatically receive a **5-day free trial** with full access to crypto alerts!

**How to Join:**
1. Search for **@arben_crypto_bot** on Telegram
2. Send `/start` to begin your free trial
3. Receive instant BUY/SELL alerts for all 12 cryptocurrencies

**Bot Commands:**
- `/start` - Begin your free 5-day trial (new users only)
- `/status` - Check your subscription status and expiry date

### Trial Features

**During Your Free Trial:**
- ✅ Real-time alerts for all 12 cryptocurrencies
- ✅ BUY/SELL/HOLD signals delivered instantly
- ✅ Auto-monitoring every 10 minutes
- ✅ No credit card required

**What Happens After Trial:**
- Automatic expiry notification sent via Telegram
- Contact support to upgrade to a paid plan
- Use admin API endpoints to activate subscriptions

### Alert Broadcasting

The system automatically broadcasts alerts to **all active (non-expired) users**:
- Monitors all 12 cryptocurrencies
- Checks every 10 minutes
- Only sends alerts when signals change from HOLD to BUY/SELL
- Includes price, RSI, and timestamp in each alert

### Admin API - User Management

**Security Note**: Admin endpoints require authentication. Set `ADMIN_SECRET` environment variable and include it in requests as `Authorization: Bearer <your-secret>`.

**Get All Users:**
```bash
GET /api/users?active=1
Authorization: Bearer your-admin-secret-here
```
Returns list of active users (filters by expiry date).

**Activate/Extend User Subscription:**
```bash
POST /api/user/activate
Authorization: Bearer your-admin-secret-here
Content-Type: application/json

{
  "chat_id": 123456789,
  "plan": "basic",
  "days": 30
}
```
Upgrades a user from trial to paid plan or extends existing subscription.

**Authentication Errors:**
- `401 Unauthorized` - Invalid or missing admin token
- `503 Service Unavailable` - ADMIN_SECRET not configured

### Setup Instructions for Bot Admin

1. Create a Telegram bot via [@BotFather](https://t.me/botfather)
2. Add secrets in Replit:
   - `TELEGRAM_BOT_TOKEN`: Your bot token from BotFather
   - `ADMIN_SECRET`: Strong secret token for admin API access (required for /api/users and /api/user/activate)
   - `TELEGRAM_CHAT_ID`: (Optional) Your admin chat ID for testing
   - `TRIAL_DAYS`: (Optional) Override default 5-day trial period

**Security Best Practices:**
- Use a strong, randomly-generated ADMIN_SECRET (e.g., 32+ characters)
- Never commit ADMIN_SECRET to your repository
- Admin endpoints return 503 if ADMIN_SECRET is not configured

## 📈 Trading Strategy

**EMA Crossover Strategy:**
- **Fast EMA**: 8-period
- **Slow EMA**: 21-period
- **BUY**: Fast EMA crosses above Slow EMA
- **SELL**: Fast EMA crosses below Slow EMA
- **HOLD**: No crossover or insufficient data

**RSI Filter:**
- RSI calculated over 14-period
- Helps identify overbought/oversold conditions
- Displayed with each signal for additional context

**Data Source:**
- Hourly candles over 7-day window (168 data points)
- Requires minimum 25 candles for reliable calculations
- CryptoCompare API (free tier, no authentication)

## 🛠️ Technical Stack

- **Runtime**: Node.js 22
- **Framework**: Express.js
- **API Client**: node-fetch
- **Technical Indicators**: technicalindicators library
- **Deployment**: Replit Autoscale (production-ready)

## 📝 Configuration

**Environment Variables:**
- `PORT`: Server port (default: 5000)
- `TELEGRAM_BOT_TOKEN`: Optional Telegram bot token
- `TELEGRAM_CHAT_ID`: Optional Telegram chat ID

**Auto-Alert Settings:**
- Monitoring: All 12 supported coins (BTC, ETH, SOL, XRP, ADA, DOGE, BNB, LTC, MATIC, AVAX, DOT, LINK)
- Check interval: 10 minutes
- Trial length: 5 days (configurable via `TRIAL_DAYS` env variable)
- Notification triggers: HOLD → BUY/SELL transitions

## ⚙️ How to Add/Remove Cryptocurrencies

To add or remove supported coins, edit the `SUPPORTED_SYMBOLS` array in `index.js`:

```javascript
const SUPPORTED_SYMBOLS = [
  'btc', 'eth', 'sol', 'xrp', 'ada', 'doge',
  'bnb', 'ltc', 'matic', 'avax', 'dot', 'link'
  // Add more coins here (use lowercase)
];
```

Then update the `SYMBOLS` mapping with the CryptoCompare ticker code:

```javascript
const SYMBOLS = {
  btc: 'BTC',
  eth: 'ETH',
  // ... existing coins ...
  yournewcoin: 'TICKER'  // Add mapping here
};
```

The dashboard will automatically display all coins in `SUPPORTED_SYMBOLS`. No other code changes needed!

## 🚀 Local Development

```bash
# Install dependencies
npm install

# Start server
npm start
# or
node index.js
```

Server runs on `http://localhost:5000`

## 📄 License

MIT License - Free to use and modify
