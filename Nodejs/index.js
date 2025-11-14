// index.js — Crypto signal server (EMA crossover + RSI filter)
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { EMA, RSI } = require('technicalindicators');
const TelegramBot = require('node-telegram-bot-api');

// Pack 1 - Faster Data Layer Modules
const OHLCCache = require('./modules/ohlc-cache');
const DataFeedManager = require('./modules/data-feed-manager');

// Pack 2 - Strategy Engine v2
const StrategyEngine = require('./modules/strategy-engine');

// Paper Trading System
const PaperTrading = require('./modules/paper-trading');

const app = express();

// CRITICAL: Ultra-fast health check BEFORE any other middleware
// This must respond immediately for Cloud Run/Autoscale deployments
app.use((req, res, next) => {
  // Health check detection for Cloud Run
  const isHealthCheck = req.path === '/' && (
    req.headers['user-agent']?.includes('GoogleHC') ||
    req.headers['user-agent']?.includes('Cloud-Run') ||
    req.method === 'HEAD' ||
    req.headers['x-cloud-run-healthcheck']
  );
  
  if (isHealthCheck) {
    return res.status(200).send('OK');
  }
  
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 5000;
const USERS_FILE = path.join(__dirname, 'users.json');

// Supported cryptocurrency symbols (lowercase for API queries)
const SUPPORTED_SYMBOLS = [
  'btc', 'eth', 'sol', 'xrp', 'ada', 'doge',
  'bnb', 'ltc', 'matic', 'avax', 'dot', 'link'
];

// Map lowercase symbols to CryptoCompare API ticker codes
const SYMBOLS = {
  btc: 'BTC',
  eth: 'ETH',
  sol: 'SOL',
  xrp: 'XRP',
  ada: 'ADA',
  doge: 'DOGE',
  bnb: 'BNB',
  ltc: 'LTC',
  matic: 'MATIC',
  avax: 'AVAX',
  dot: 'DOT',
  link: 'LINK'
};

// --- Trial System Configuration ---
const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS) || 5;
const TRIAL_PLAN = 'trial';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

// --- Pack 1: Faster Data Layer Configuration ---
// Using free APIs: KuCoin WebSocket + CoinGecko batch fallback (no config needed)

// --- Auto-Alert System Configuration ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const ALERT_EMAIL = process.env.ALERT_EMAIL || '';
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// Store last signals in memory to detect changes (per strategy-symbol combo)
const lastSignals = {
  day: {},
  swing: {},
  long: {}
};
SUPPORTED_SYMBOLS.forEach(sym => {
  lastSignals.day[sym] = null;
  lastSignals.swing[sym] = null;
  lastSignals.long[sym] = null;
});

// --- Initialize Telegram Bot (Webhook mode) ---
const WEBHOOK_URL = `https://${process.env.REPLIT_DEV_DOMAIN || 'nodejs-arbenoruci.replit.app'}/telegram/webhook`;
let bot;
if (TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_TOKEN.length > 20) {
  try {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
    console.log('🤖 Telegram bot initialized (webhook mode)');
  } catch (error) {
    console.error('Failed to initialize Telegram bot:', error.message);
  }
} else if (TELEGRAM_BOT_TOKEN) {
  console.log('⚠️  TELEGRAM_BOT_TOKEN appears invalid (too short)');
}

// --- User Management Functions ---
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      const users = JSON.parse(data);
      // Backfill strategy field for legacy users
      return users.map(u => ({
        ...u,
        strategy: u.strategy || 'swing'
      }));
    }
  } catch (error) {
    console.error('Error loading users:', error.message);
  }
  return [];
}

function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error('Error saving users:', error.message);
  }
}

function addDays(dateISO, days) {
  const date = new Date(dateISO);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function getActiveUsers() {
  const users = loadUsers();
  const now = new Date().toISOString();
  return users.filter(u => u.expires_at > now);
}

function getUserByChatId(chatId) {
  const users = loadUsers();
  return users.find(u => u.chat_id === chatId);
}

function updateUser(chatId, updates) {
  const users = loadUsers();
  const index = users.findIndex(u => u.chat_id === chatId);
  if (index !== -1) {
    users[index] = { ...users[index], ...updates };
    saveUsers(users);
    return users[index];
  }
  return null;
}

// --- Send alert notification to users with matching strategy ---
async function sendAlert(symbol, signal, price, lastRSI, strategy) {
  const strategyEmoji = {
    'day': '⚡',
    'swing': '📊',
    'long': '🛡️'
  }[strategy] || '📊';
  
  const strategyName = {
    'day': 'DAY TRADING',
    'swing': 'SWING TRADING',
    'long': 'LONG-TERM'
  }[strategy] || 'SWING TRADING';
  
  const message = `${strategyEmoji} ${symbol.toUpperCase()} ${signal}!\n\n` +
    `Strategy: ${strategyName}\n` +
    `Signal: ${signal}\n` +
    `Price: $${price.toLocaleString()}\n` +
    `RSI: ${lastRSI.toFixed(2)}\n` +
    `Time: ${new Date().toLocaleString()}`;

  console.log('\n' + '='.repeat(50));
  console.log(`[${strategy.toUpperCase()}] ${symbol.toUpperCase()}: ${signal}`);
  console.log('='.repeat(50) + '\n');

  // Broadcast only to active users with matching strategy
  if (bot) {
    const users = loadUsers();
    const now = new Date().toISOString();
    // Default to 'swing' for users without a strategy field (backward compatibility)
    const matchingUsers = users.filter(u => u.expires_at > now && (u.strategy || 'swing') === strategy);
    let sentCount = 0;
    
    for (const user of matchingUsers) {
      try {
        await bot.sendMessage(user.chat_id, message);
        sentCount++;
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Failed to send to ${user.chat_id}:`, error.message);
      }
    }
    
    console.log(`✅ Sent to ${sentCount}/${matchingUsers.length} users with ${strategy} strategy`);
  }
}

// --- Check signals for all strategies and send alerts on change ---
async function checkSignals() {
  const strategies = ['day', 'swing', 'long'];
  
  // Check each strategy separately
  for (const strategy of strategies) {
    for (let i = 0; i < SUPPORTED_SYMBOLS.length; i++) {
      const symbol = SUPPORTED_SYMBOLS[i];
      try {
        const data = await getSignal(symbol, strategy);
        const currentSignal = data.signal;
        const previousSignal = lastSignals[strategy][symbol];

        // Alert on any change to BUY or SELL (including null→BUY/SELL and BUY↔SELL)
        const shouldAlert = (currentSignal === 'BUY' || currentSignal === 'SELL') && 
                           currentSignal !== previousSignal;

        if (shouldAlert) {
          await sendAlert(symbol, currentSignal, data.price, data.lastRSI, strategy);
        }

        // Update stored signal for this strategy
        lastSignals[strategy][symbol] = currentSignal;

        console.log(`[${new Date().toLocaleTimeString()}] ${symbol.toUpperCase()} [${strategy}]: ${currentSignal} (prev: ${previousSignal || 'N/A'})`);
        
        // Add 500ms delay between requests to avoid rate limiting
        if (i < SUPPORTED_SYMBOLS.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`Error checking ${symbol.toUpperCase()} [${strategy}] signal:`, error.message);
      }
    }
  }
  
  // Check for expired users and send notification
  await checkExpiredUsers();
}

// --- Check for expired users and send one-time notification ---
async function checkExpiredUsers() {
  if (!bot) return;
  
  const users = loadUsers();
  const now = new Date().toISOString();
  
  for (const user of users) {
    // User expired and hasn't been notified
    if (user.expires_at < now && !user.trial_notified) {
      try {
        await bot.sendMessage(
          user.chat_id,
          `⏳ Your free trial has ended.\n\nTo keep receiving crypto alerts, please contact support or upgrade your plan.\n\nThank you for trying Arben's Crypto Signals!`
        );
        updateUser(user.chat_id, { trial_notified: true });
        console.log(`📢 Sent expiry notification to user ${user.chat_id}`);
      } catch (error) {
        console.error(`Failed to notify user ${user.chat_id}:`, error.message);
      }
    }
  }
}

// --- Telegram Webhook Handler Functions ---
async function handleStartCommand(chatId, username, firstName, parameter = '') {
  let user = getUserByChatId(chatId);
  const validStrategies = ['day', 'swing', 'long'];
  const selectedStrategy = validStrategies.includes(parameter) ? parameter : null;
  
  if (!user) {
    const now = new Date().toISOString();
    const expiresAt = addDays(now, TRIAL_DAYS);
    const expiryDate = new Date(expiresAt).toLocaleDateString();
    
    const newUser = {
      chat_id: chatId,
      username,
      first_name: firstName,
      plan: TRIAL_PLAN,
      strategy: selectedStrategy || 'swing',
      referred_by: null,
      created_at: now,
      expires_at: expiresAt,
      trial_notified: false
    };
    
    const users = loadUsers();
    if (!users.find(u => u.chat_id === chatId)) {
      users.push(newUser);
      saveUsers(users);
      console.log(`[Trial] Started ${TRIAL_DAYS}-day trial for chat_id=${chatId}, strategy=${newUser.strategy}`);
    }
    
    const strategyName = {
      'day': '⚡ DAY TRADING (High Risk)',
      'swing': '📊 SWING TRADING (Medium Risk)',
      'long': '🛡️ LONG-TERM (Low Risk)'
    }[newUser.strategy] || '📊 SWING TRADING';
    
    return `👋 Welcome to Arben's Crypto Signals!\n\n` +
           `✅ Your ${TRIAL_DAYS}-day trial started!\n` +
           `📈 Strategy: ${strategyName}\n\n` +
           `To change strategy, send:\n` +
           `/start day - Fast day trading signals\n` +
           `/start swing - Balanced swing trading\n` +
           `/start long - Patient long-term holds\n\n` +
           `Supported coins: ${SUPPORTED_SYMBOLS.map(s => s.toUpperCase()).join(', ')}\n\n` +
           `Trial expires: ${expiryDate}`;
  } else {
    if (selectedStrategy && selectedStrategy !== user.strategy) {
      updateUser(chatId, { strategy: selectedStrategy });
      const strategyName = {
        'day': '⚡ DAY TRADING (High Risk)',
        'swing': '📊 SWING TRADING (Medium Risk)',
        'long': '🛡️ LONG-TERM (Low Risk)'
      }[selectedStrategy];
      console.log(`[Strategy] User ${chatId} switched to ${selectedStrategy}`);
      return `✅ Strategy updated to ${strategyName}!\n\nYou'll now receive signals optimized for this trading style.`;
    }
    return `👋 Welcome back${firstName ? ' ' + firstName : ''}!\n\nType 'status' to check your subscription or '/start day|swing|long' to change strategy.`;
  }
}

async function handleStatusCommand(chatId) {
  const user = getUserByChatId(chatId);
  
  if (!user) {
    return `You're not registered yet. Send /start to begin your free trial!`;
  }
  
  const now = new Date();
  const expiresAt = new Date(user.expires_at);
  const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));
  const isActive = user.expires_at > now.toISOString();
  
  if (!isActive) {
    return `Your trial ended — contact @arben_crypto_bot to extend.`;
  }
  
  const strategyName = {
    'day': '⚡ DAY TRADING (High Risk)',
    'swing': '📊 SWING TRADING (Medium Risk)',
    'long': '🛡️ LONG-TERM (Low Risk)'
  }[user.strategy] || '📊 SWING TRADING';
  
  let statusMessage = `📊 Subscription Status\n\n`;
  statusMessage += `Plan: ${user.plan.toUpperCase()}\n`;
  statusMessage += `Strategy: ${strategyName}\n`;
  statusMessage += `Status: ✅ Active\n`;
  statusMessage += `Expires: ${expiresAt.toLocaleDateString()}\n`;
  statusMessage += `Days left: ${daysRemaining}\n\n`;
  statusMessage += `Coins: ${SUPPORTED_SYMBOLS.map(s => s.toUpperCase()).join(', ')}\n\n`;
  statusMessage += `Change strategy: /start day|swing|long`;
  
  return statusMessage;
}

function handleHelpCommand() {
  const domain = process.env.REPLIT_DEV_DOMAIN || 'nodejs-arbenoruci.replit.app';
  const dashboardUrl = `https://${domain}/dashboard.html`;
  
  return `🤖 Arben's Crypto Signals Bot\n\n` +
         `Commands:\n` +
         `/start - Begin your 5-day free trial\n` +
         `status - Check subscription status\n\n` +
         `Supported: ${SUPPORTED_SYMBOLS.map(s => s.toUpperCase()).join(', ')}\n\n` +
         `📊 View live dashboard: ${dashboardUrl}`;
}

// --- fetch price data from CryptoCompare (free, no API key required) ---
async function getPriceData(symbol = 'btc', timeframe = 'hour', limit = 168) {
  const fsym = SYMBOLS[symbol] || SYMBOLS.btc;
  
  const endpoints = {
    'minute': `https://min-api.cryptocompare.com/data/v2/histominute?fsym=${fsym}&tsym=USD&limit=${limit}`,
    'hour': `https://min-api.cryptocompare.com/data/v2/histohour?fsym=${fsym}&tsym=USD&limit=${limit}`,
    'day': `https://min-api.cryptocompare.com/data/v2/histoday?fsym=${fsym}&tsym=USD&limit=${limit}`
  };
  
  const url = endpoints[timeframe] || endpoints.hour;
  
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CryptoCompare API error ${res.status}`);
  const json = await res.json();
  
  if (json.Response === 'Error') {
    throw new Error(json.Message || 'API error');
  }
  
  if (!json.Data || !json.Data.Data || json.Data.Data.length === 0) {
    throw new Error('No price data available');
  }
  
  return json.Data.Data.map(candle => candle.close);
}

async function getHourlyPrices(symbol = 'btc', days = 7) {
  return getPriceData(symbol, 'hour', days * 24);
}

// --- generate trading signals for different strategies ---

// DAY TRADING: 15-min candles, EMA 5/13, aggressive signals
async function getDayTradingSignal(symbol = 'btc') {
  const minuteData = await getPriceData(symbol, 'minute', 2000);
  
  if (minuteData.length < 300) {
    return { signal: 'HOLD', reason: 'Not enough data', strategy: 'day' };
  }
  
  const closes = [];
  for (let i = 14; i < minuteData.length; i += 15) {
    closes.push(minuteData[i]);
  }
  
  if (closes.length < 20) {
    return { signal: 'HOLD', reason: 'Not enough data', strategy: 'day' };
  }
  
  const emaFast = EMA.calculate({ period: 5, values: closes });
  const emaSlow = EMA.calculate({ period: 13, values: closes });
  const rsiVals = RSI.calculate({ period: 14, values: closes });
  
  const n = Math.min(emaFast.length, emaSlow.length, rsiVals.length);
  if (n < 3) return { signal: 'HOLD', reason: 'Not enough data', strategy: 'day' };
  
  const f = emaFast.slice(-n);
  const s = emaSlow.slice(-n);
  const r = rsiVals.slice(-n);
  const price = closes[closes.length - 1];
  
  const crossedUp = f[n - 2] <= s[n - 2] && f[n - 1] > s[n - 1];
  const crossedDown = f[n - 2] >= s[n - 2] && f[n - 1] < s[n - 1];
  const lastRSI = r[r.length - 1];
  
  if (crossedUp && lastRSI < 75) {
    return { signal: 'BUY', price, lastRSI, emaFast: f[n - 1], emaSlow: s[n - 1], strategy: 'day' };
  }
  if (crossedDown && lastRSI > 25) {
    return { signal: 'SELL', price, lastRSI, emaFast: f[n - 1], emaSlow: s[n - 1], strategy: 'day' };
  }
  return { signal: 'HOLD', price, lastRSI, emaFast: f[n - 1], emaSlow: s[n - 1], strategy: 'day' };
}

// SWING TRADING: 4-hour candles, EMA 8/21, balanced signals
async function getSwingTradingSignal(symbol = 'btc') {
  const hourlyData = await getPriceData(symbol, 'hour', 350);
  
  if (hourlyData.length < 100) {
    return { signal: 'HOLD', reason: 'Not enough data', strategy: 'swing' };
  }
  
  const closes = [];
  for (let i = 3; i < hourlyData.length; i += 4) {
    closes.push(hourlyData[i]);
  }
  
  if (closes.length < 25) {
    return { signal: 'HOLD', reason: 'Not enough data', strategy: 'swing' };
  }
  
  const emaFast = EMA.calculate({ period: 8, values: closes });
  const emaSlow = EMA.calculate({ period: 21, values: closes });
  const rsiVals = RSI.calculate({ period: 14, values: closes });
  
  const n = Math.min(emaFast.length, emaSlow.length, rsiVals.length);
  if (n < 3) return { signal: 'HOLD', reason: 'Not enough data', strategy: 'swing' };
  
  const f = emaFast.slice(-n);
  const s = emaSlow.slice(-n);
  const r = rsiVals.slice(-n);
  const price = closes[closes.length - 1];
  
  const crossedUp = f[n - 2] <= s[n - 2] && f[n - 1] > s[n - 1];
  const crossedDown = f[n - 2] >= s[n - 2] && f[n - 1] < s[n - 1];
  const lastRSI = r[r.length - 1];
  
  if (crossedUp && lastRSI < 70) {
    return { signal: 'BUY', price, lastRSI, emaFast: f[n - 1], emaSlow: s[n - 1], strategy: 'swing' };
  }
  if (crossedDown && lastRSI > 30) {
    return { signal: 'SELL', price, lastRSI, emaFast: f[n - 1], emaSlow: s[n - 1], strategy: 'swing' };
  }
  return { signal: 'HOLD', price, lastRSI, emaFast: f[n - 1], emaSlow: s[n - 1], strategy: 'swing' };
}

// LONG-TERM: Daily candles, EMA 50/200, patient signals
async function getLongTermSignal(symbol = 'btc') {
  const closes = await getPriceData(symbol, 'day', 250);
  
  if (closes.length < 205) {
    return { signal: 'HOLD', reason: 'Not enough data', strategy: 'long' };
  }
  
  const emaFast = EMA.calculate({ period: 50, values: closes });
  const emaSlow = EMA.calculate({ period: 200, values: closes });
  const rsiVals = RSI.calculate({ period: 14, values: closes });
  
  const n = Math.min(emaFast.length, emaSlow.length, rsiVals.length);
  if (n < 3) return { signal: 'HOLD', reason: 'Not enough data', strategy: 'long' };
  
  const f = emaFast.slice(-n);
  const s = emaSlow.slice(-n);
  const r = rsiVals.slice(-n);
  const price = closes[closes.length - 1];
  
  const crossedUp = f[n - 2] <= s[n - 2] && f[n - 1] > s[n - 1];
  const crossedDown = f[n - 2] >= s[n - 2] && f[n - 1] < s[n - 1];
  const lastRSI = r[r.length - 1];
  
  if (crossedUp && lastRSI < 65) {
    return { signal: 'BUY', price, lastRSI, emaFast: f[n - 1], emaSlow: s[n - 1], strategy: 'long' };
  }
  if (crossedDown && lastRSI > 35) {
    return { signal: 'SELL', price, lastRSI, emaFast: f[n - 1], emaSlow: s[n - 1], strategy: 'long' };
  }
  return { signal: 'HOLD', price, lastRSI, emaFast: f[n - 1], emaSlow: s[n - 1], strategy: 'long' };
}

// Wrapper function to get signal based on strategy
async function getSignal(symbol = 'btc', strategy = 'swing') {
  // Use Strategy Engine v2 with OHLC cache (no API calls!)
  if (strategyEngine) {
    const planMap = { day: 'short', swing: 'medium', long: 'long' };
    const plan = planMap[strategy] || 'medium';
    
    try {
      const analysis = await strategyEngine.analyzeSymbol(symbol, plan);
      
      if (analysis && analysis.indicators && analysis.indicators.price) {
        return {
          signal: analysis.signal || 'HOLD',
          price: analysis.indicators.price,
          lastRSI: analysis.indicators.rsi,
          emaFast: analysis.indicators.emaFast,
          emaSlow: analysis.indicators.emaSlow,
          confidence: analysis.confidence || 0,
          strategy
        };
      } else {
        // Strategy engine returned null - return default HOLD (don't call API)
        const lastPrice = ohlcCache ? ohlcCache.getLatestPrice(symbol) : null;
        return {
          signal: 'HOLD',
          price: lastPrice?.price || 0,
          lastRSI: 50,
          emaFast: 0,
          emaSlow: 0,
          confidence: 0,
          strategy,
          reason: 'Insufficient data'
        };
      }
    } catch (err) {
      console.error(`❌ Strategy engine error for ${symbol} [${strategy}]:`, err.message);
      // Return default HOLD on error (don't call API)
      const lastPrice = ohlcCache ? ohlcCache.getLatestPrice(symbol) : null;
      return {
        signal: 'HOLD',
        price: lastPrice?.price || 0,
        lastRSI: 50,
        emaFast: 0,
        emaSlow: 0,
        confidence: 0,
        strategy,
        reason: 'Error: ' + err.message
      };
    }
  }
  
  // If no strategy engine, return error (don't fallback to API calls)
  throw new Error('Strategy engine not initialized');
}

// --- toy paper trader (stateless-ish demo) ---
let paper = {
  cash: 1000,         // start fake balance
  position: 0,        // units (e.g., BTC)
  lastPrice: null
};

async function stepPaper(symbol = 'btc') {
  const s = await getSignal(symbol);
  const price = s.price;
  paper.lastPrice = price;

  // simple rules: all-in buy/sell on signals (for demo only!)
  if (s.signal === 'BUY' && paper.cash > 1) {
    paper.position = paper.cash / price;
    paper.cash = 0;
  } else if (s.signal === 'SELL' && paper.position > 0) {
    paper.cash = paper.position * price;
    paper.position = 0;
  }
  const equity = paper.cash + paper.position * price;
  return { ...s, paper: { ...paper, equity: Number(equity.toFixed(2)) } };
}

// --- routes ---

// Fast health check endpoint for deployment
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ ok: true, msg: 'healthy' });
});

// Get list of supported symbols
app.get('/api/symbols', (req, res) => {
  res.json({ 
    ok: true, 
    symbols: SUPPORTED_SYMBOLS,
    count: SUPPORTED_SYMBOLS.length
  });
});

// Root endpoint - fast health check response
app.get('/', (req, res) => {
  res.send('OK');
});

// API documentation route (moved to /api)
app.get('/api', (req, res) => {
  const domain = process.env.REPLIT_DEV_DOMAIN || 'localhost:5000';
  const protocol = domain.includes('localhost') ? 'http' : 'https';
  const baseUrl = `${protocol}://${domain}`;
  
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Crypto Signal API Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      border-radius: 20px;
      padding: 40px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    h1 {
      color: #333;
      margin-bottom: 10px;
      font-size: 2.5em;
    }
    .subtitle {
      color: #666;
      margin-bottom: 30px;
      font-size: 1.1em;
    }
    .section {
      margin: 30px 0;
    }
    .section h2 {
      color: #667eea;
      margin-bottom: 15px;
      font-size: 1.5em;
      border-bottom: 2px solid #f0f0f0;
      padding-bottom: 10px;
    }
    .endpoint {
      background: #f8f9fa;
      padding: 15px;
      margin: 10px 0;
      border-radius: 10px;
      border-left: 4px solid #667eea;
    }
    .endpoint a {
      color: #667eea;
      text-decoration: none;
      font-weight: 500;
      display: block;
      margin: 5px 0;
    }
    .endpoint a:hover {
      text-decoration: underline;
    }
    .description {
      color: #666;
      font-size: 0.9em;
      margin-top: 5px;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      background: #28a745;
      color: white;
      border-radius: 12px;
      font-size: 0.8em;
      margin-left: 10px;
    }
    .info-box {
      background: #e7f3ff;
      padding: 15px;
      border-radius: 10px;
      margin: 20px 0;
      border-left: 4px solid #2196F3;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 Crypto Signal API</h1>
    <p class="subtitle">Real-time cryptocurrency trading signals using EMA & RSI technical analysis</p>
    
    <div class="info-box">
      <strong>🌐 Public Access:</strong> This API is live and accessible externally<br>
      <strong>📊 Supported Cryptos (12):</strong> BTC, ETH, SOL, XRP, ADA, DOGE, BNB, LTC, MATIC, AVAX, DOT, LINK
    </div>

    <div class="section">
      <h2>System Health</h2>
      <div class="endpoint">
        <a href="/api/health" target="_blank">/api/health</a>
        <span class="badge">GET</span>
        <p class="description">Returns server health status</p>
      </div>
      <div class="endpoint">
        <a href="/api/symbols" target="_blank">/api/symbols</a>
        <span class="badge">GET</span>
        <p class="description">Get list of all supported cryptocurrency symbols</p>
      </div>
    </div>

    <div class="section">
      <h2>Trading Signals</h2>
      <div class="endpoint">
        <a href="/api/signal?symbol=btc" target="_blank">/api/signal?symbol=btc</a>
        <span class="badge">GET</span>
        <p class="description">Get BUY/SELL/HOLD signal for Bitcoin with EMA & RSI analysis</p>
      </div>
      <div class="endpoint">
        <a href="/api/signal?symbol=eth" target="_blank">/api/signal?symbol=eth</a>
        <span class="badge">GET</span>
        <p class="description">Get trading signal for Ethereum</p>
      </div>
      <div class="endpoint">
        <a href="/api/signal?symbol=sol" target="_blank">/api/signal?symbol=sol</a>
        <span class="badge">GET</span>
        <p class="description">Get trading signal for Solana</p>
      </div>
      <div class="endpoint">
        <a href="/api/signal?symbol=avax" target="_blank">/api/signal?symbol=avax</a>
        <span class="badge">GET</span>
        <p class="description">Get trading signal for Avalanche</p>
      </div>
      <div class="endpoint">
        <a href="/api/signal?symbol=link" target="_blank">/api/signal?symbol=link</a>
        <span class="badge">GET</span>
        <p class="description">Get trading signal for Chainlink</p>
      </div>
      <div class="endpoint">
        <a href="/api/signal?symbol=bnb" target="_blank">/api/signal?symbol=bnb</a>
        <span class="badge">GET</span>
        <p class="description">Get trading signal for Binance Coin</p>
      </div>
      <p style="margin-top:10px; color:#666; font-size:0.9em;">Support for 12 cryptocurrencies total - use /api/symbols for the full list</p>
    </div>

    <div class="section">
      <h2>Paper Trading</h2>
      <div class="endpoint">
        <a href="/api/paper?symbol=btc" target="_blank">/api/paper?symbol=btc</a>
        <span class="badge">GET</span>
        <p class="description">Get signal with simulated paper trading portfolio</p>
      </div>
    </div>

    <div class="section">
      <h2>Alert System</h2>
      <div class="endpoint">
        <a href="/api/alerts/status" target="_blank">/api/alerts/status</a>
        <span class="badge">GET</span>
        <p class="description">View auto-alert system status (monitors BTC & ETH every 10 minutes)</p>
      </div>
    </div>

    <div class="section">
      <h2>📱 Web Dashboard</h2>
      <div class="endpoint">
        <a href="/dashboard.html" target="_blank">/dashboard.html</a>
        <span class="badge">VIEW</span>
        <p class="description">Interactive web dashboard with auto-refreshing crypto cards</p>
      </div>
    </div>
  </div>
</body>
</html>
  `);
});

app.get('/api/signal', async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'btc').toLowerCase();
    const strategy = (req.query.strategy || 'swing').toLowerCase();
    
    // Validate symbol
    if (!SUPPORTED_SYMBOLS.includes(symbol)) {
      return res.status(400).json({ ok: false, error: 'unsupported symbol' });
    }
    
    // Validate strategy
    if (!['day', 'swing', 'long'].includes(strategy)) {
      return res.status(400).json({ ok: false, error: 'invalid strategy. Use: day, swing, or long' });
    }
    
    const data = await getSignal(symbol, strategy);
    const time = new Date().toISOString();
    res.json({ ok: true, symbol, strategy, time, ...data });
  } catch (e) {
    console.error(`❌ Error in /api/signal for ${req.query.symbol} [${req.query.strategy}]:`, e.message);
    console.error('Stack:', e.stack);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

app.get('/api/paper', async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'btc').toLowerCase();
    
    // Validate symbol
    if (!SUPPORTED_SYMBOLS.includes(symbol)) {
      return res.status(400).json({ ok: false, error: 'unsupported symbol' });
    }
    
    const data = await stepPaper(symbol);
    res.json({ ok: true, symbol, ...data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/api/alerts/status', (req, res) => {
  res.json({
    ok: true,
    alertSystem: 'active',
    monitoredSymbols: SUPPORTED_SYMBOLS,
    symbolCount: SUPPORTED_SYMBOLS.length,
    checkInterval: '10 minutes',
    telegramConfigured: !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID),
    lastSignals: lastSignals,
    nextCheckIn: CHECK_INTERVAL_MS / 1000 / 60 + ' minutes'
  });
});

app.post('/api/alerts/check-now', async (req, res) => {
  try {
    await checkSignals();
    res.json({ 
      ok: true, 
      message: 'Signal check completed',
      currentSignals: lastSignals
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/api/test-alert', async (req, res) => {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return res.json({ ok: false, error: 'Telegram not configured' });
  }

  try {
    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: 'Test alert from CryptoBot ✅'
      })
    });

    if (response.ok) {
      res.json({ ok: true, message: 'Test alert sent successfully' });
    } else {
      const error = await response.text();
      res.json({ ok: false, error: `Telegram API error: ${error}` });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// --- Admin Authentication Middleware ---
function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  const providedSecret = authHeader?.replace('Bearer ', '');
  
  if (!ADMIN_SECRET) {
    return res.status(503).json({
      ok: false,
      error: 'Admin endpoints disabled. Set ADMIN_SECRET in environment.'
    });
  }
  
  if (!providedSecret || providedSecret !== ADMIN_SECRET) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized. Valid admin token required.'
    });
  }
  
  next();
}

// --- User Management Admin APIs (Protected) ---

app.get('/api/users', requireAdmin, (req, res) => {
  try {
    const users = loadUsers();
    const activeOnly = req.query.active === '1' || req.query.active === 'true';
    
    let filteredUsers = users;
    if (activeOnly) {
      const now = new Date().toISOString();
      filteredUsers = users.filter(u => u.expires_at > now);
    }
    
    // Return minimal necessary data (exclude referral codes)
    const publicUsers = filteredUsers.map(u => ({
      chat_id: u.chat_id,
      username: u.username,
      first_name: u.first_name,
      plan: u.plan,
      created_at: u.created_at,
      expires_at: u.expires_at
    }));
    
    res.json({
      ok: true,
      count: publicUsers.length,
      users: publicUsers
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/user/activate', requireAdmin, (req, res) => {
  try {
    const { chat_id, plan, days } = req.body;
    
    if (!chat_id || !plan || !days) {
      return res.status(400).json({
        ok: false,
        error: 'Required fields: chat_id, plan, days'
      });
    }
    
    const user = getUserByChatId(chat_id);
    if (!user) {
      return res.status(404).json({
        ok: false,
        error: 'User not found'
      });
    }
    
    const now = new Date().toISOString();
    const expiresAt = addDays(now, parseInt(days));
    
    const updatedUser = updateUser(chat_id, {
      plan: plan,
      expires_at: expiresAt,
      trial_notified: false
    });
    
    // Notify user about activation
    if (bot) {
      bot.sendMessage(
        chat_id,
        `🎉 Your subscription has been activated!\n\n` +
        `Plan: ${plan.toUpperCase()}\n` +
        `Valid until: ${new Date(expiresAt).toLocaleDateString()}\n\n` +
        `You'll continue receiving crypto alerts for all supported coins!`
      ).catch(err => console.error('Failed to notify user:', err.message));
    }
    
    console.log(`[Activation] User ${chat_id} activated: ${plan} for ${days} days`);
    
    res.json({
      ok: true,
      message: 'User activated successfully',
      user: {
        chat_id: updatedUser.chat_id,
        plan: updatedUser.plan,
        expires_at: updatedUser.expires_at
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// --- Broadcast Message to All Active Users ---
app.post('/api/broadcast', requireAdmin, async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({
        ok: false,
        error: 'Required field: message'
      });
    }
    
    if (!bot) {
      return res.status(503).json({
        ok: false,
        error: 'Telegram bot not initialized'
      });
    }
    
    const users = loadUsers();
    const now = new Date().toISOString();
    const activeUsers = users.filter(u => u.expires_at > now);
    
    let successCount = 0;
    let failCount = 0;
    const results = [];
    
    for (const user of activeUsers) {
      try {
        await bot.sendMessage(user.chat_id, message);
        successCount++;
        results.push({ chat_id: user.chat_id, status: 'sent' });
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        failCount++;
        results.push({ chat_id: user.chat_id, status: 'failed', error: error.message });
        console.error(`Failed to send to ${user.chat_id}:`, error.message);
      }
    }
    
    console.log(`[Broadcast] Sent to ${successCount}/${activeUsers.length} users`);
    
    res.json({
      ok: true,
      message: 'Broadcast completed',
      total_active_users: activeUsers.length,
      success: successCount,
      failed: failCount,
      results: results
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// --- Telegram Webhook Endpoint (Secured with token validation) ---
app.post('/telegram/webhook', async (req, res) => {
  try {
    // Verify request is from Telegram by checking secret token header
    const secretToken = req.headers['x-telegram-bot-api-secret-token'];
    const expectedToken = process.env.WEBHOOK_SECRET || 'default-secret-change-me';
    
    if (secretToken !== expectedToken) {
      console.warn('[Webhook] Unauthorized request - invalid secret token');
      return res.sendStatus(401);
    }
    
    const update = req.body;
    
    if (!update.message) {
      return res.sendStatus(200);
    }
    
    const chatId = update.message.chat.id;
    const text = (update.message.text || '').trim();
    const username = update.message.from?.username || '';
    const firstName = update.message.from?.first_name || '';
    
    console.log(`[Webhook] Received: "${text}" from ${chatId}`);
    
    let responseText;
    
    if (text.startsWith('/start')) {
      const referralCode = text.replace('/start', '').trim();
      responseText = await handleStartCommand(chatId, username, firstName, referralCode);
    } else if (text.toLowerCase() === 'status' || text === '/status') {
      responseText = await handleStatusCommand(chatId);
    } else {
      responseText = handleHelpCommand();
    }
    
    if (bot && responseText) {
      await bot.sendMessage(chatId, responseText);
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('[Webhook] Error:', error.message);
    res.sendStatus(500);
  }
});

// ========================================
// PACK 1 - FASTER DATA LAYER API ENDPOINTS
// ========================================

// Initialize Pack 1 & 2 modules
let ohlcCache, dataFeedManager, strategyEngine;
let paperTradingBots = {}; // { day, swing, long }

async function initializePack1() {
  console.log('\n📊 Initializing Pack 1: Faster Data Layer...');
  console.log('🔧 Using FREE APIs: KuCoin WebSocket + CoinGecko batch fallback');
  
  // Create OHLC cache
  ohlcCache = new OHLCCache(500);
  console.log('✅ OHLC Cache initialized (500 bars per timeframe)');
  
  // Create DataFeedManager (replaces BinanceWS + HTTPFallback)
  dataFeedManager = new DataFeedManager(ohlcCache, { enabled: true });
  console.log('✅ DataFeedManager created');
  
  // Initialize multi-source price feed
  console.log('⏳ Connecting to KuCoin WebSocket and loading historical data...');
  await dataFeedManager.initialize();
  console.log('✅ Price feeds connected');
  
  // Verify we have data for all symbols (check 1h bars since that's what we fetch)
  const metrics = ohlcCache.getMetrics();
  const readySymbols = Object.keys(metrics.symbols).filter(sym => {
    const bars1h = metrics.symbols[sym].bars['1h'] || 0;
    return bars1h >= 200; // Need 200+ bars for EMA200
  });
  
  console.log(`✅ Data ready for ${readySymbols.length}/${SUPPORTED_SYMBOLS.length} symbols`);
  
  if (readySymbols.length < SUPPORTED_SYMBOLS.length) {
    console.warn(`⚠️  Some symbols still loading. Ready: ${readySymbols.join(', ').toUpperCase()}`);
    console.log('   WebSocket will provide live updates as they arrive');
  }
  
  console.log('✅ Pack 1 initialization complete\n');
}

function initializePack2() {
  console.log('\n🎯 Initializing Pack 2: Strategy Engine v2...');
  
  if (!ohlcCache) {
    console.error('❌ Cannot initialize Pack 2: OHLC Cache not available');
    throw new Error('OHLC Cache not available');
  }
  
  strategyEngine = new StrategyEngine(ohlcCache);
  console.log('✅ Strategy Engine v2 initialized (multi-indicator, multi-timeframe)\n');
}

async function initializePaperTrading() {
  console.log('\n💰 Initializing Paper Trading System (3 Strategies)...');
  
  if (!strategyEngine) {
    console.error('❌ Cannot initialize Paper Trading: Strategy Engine not available');
    return;
  }
  
  // Day Trading Bot - 1 week challenge
  paperTradingBots.day = new PaperTrading(strategyEngine, {
    strategyName: 'day',
    initialBalance: 1000,
    positionSize: 0.10,
    maxPositions: 3,
    stopLossPct: 0.02,
    takeProfitPct: 0.05,
    plan: 'short',
    challengeDuration: '1 week',
    telegramBot: bot,
    telegramChatId: TELEGRAM_CHAT_ID
  });
  
  // Swing Trading Bot - 1 month challenge
  paperTradingBots.swing = new PaperTrading(strategyEngine, {
    strategyName: 'swing',
    initialBalance: 1000,
    positionSize: 0.10,
    maxPositions: 3,
    stopLossPct: 0.03,
    takeProfitPct: 0.08,
    plan: 'medium',
    challengeDuration: '1 month',
    telegramBot: bot,
    telegramChatId: TELEGRAM_CHAT_ID
  });
  
  // Long-Term Trading Bot - 6 months challenge
  paperTradingBots.long = new PaperTrading(strategyEngine, {
    strategyName: 'long',
    initialBalance: 1000,
    positionSize: 0.10,
    maxPositions: 3,
    stopLossPct: 0.05,
    takeProfitPct: 0.15,
    plan: 'long',
    challengeDuration: '6 months',
    telegramBot: bot,
    telegramChatId: TELEGRAM_CHAT_ID
  });
  
  // Initialize all three bots
  await paperTradingBots.day.initialize();
  console.log('✅ Day Trading Bot initialized ($1000, 1 week challenge)');
  
  await paperTradingBots.swing.initialize();
  console.log('✅ Swing Trading Bot initialized ($1000, 1 month challenge)');
  
  await paperTradingBots.long.initialize();
  console.log('✅ Long-Term Trading Bot initialized ($1000, 6 months challenge)');
  
  // Auto-check all three strategies every 60 seconds
  let checkCounter = 0;
  setInterval(async () => {
    try {
      checkCounter++;
      const timestamp = new Date().toLocaleTimeString();
      let totalActions = 0;
      
      for (const [strategyName, bot] of Object.entries(paperTradingBots)) {
        const actions = await bot.checkAndExecuteTrades(SUPPORTED_SYMBOLS);
        totalActions += actions.length;
        if (actions.length > 0) {
          console.log(`📊 ${strategyName.toUpperCase()} Trading: ${actions.length} actions executed`);
        }
      }
      
      // Heartbeat every 5 minutes to show system is alive
      if (checkCounter % 5 === 0) {
        console.log(`💓 [${timestamp}] Paper trading heartbeat #${checkCounter} - System running continuously`);
      }
      
      if (totalActions === 0 && checkCounter % 10 === 0) {
        console.log(`🔍 [${timestamp}] Monitoring active - No trades executed (waiting for entry/exit conditions)`);
      }
    } catch (err) {
      console.error('❌ Paper trading error:', err.message);
      console.error('Stack:', err.stack);
    }
  }, 60000);
  
  console.log('✅ All Paper Trading bots auto-check enabled (every 60 seconds)');
}

// GET /api/price?symbol=btc - Get latest price and source
app.get('/api/price', (req, res) => {
  try {
    const symbol = (req.query.symbol || 'btc').toLowerCase();
    
    if (!SUPPORTED_SYMBOLS.includes(symbol)) {
      return res.status(400).json({ ok: false, error: 'unsupported symbol' });
    }
    
    if (!ohlcCache) {
      return res.status(503).json({ ok: false, error: 'data layer not initialized' });
    }
    
    const priceData = ohlcCache.getLatestPrice(symbol);
    
    res.json({
      ok: true,
      symbol,
      price: priceData.price,
      source: priceData.source,
      timestamp: priceData.time,
      time: priceData.time ? new Date(priceData.time).toISOString() : null
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET /api/ohlc?symbol=btc&tf=1m&count=100 - Get OHLC bars
app.get('/api/ohlc', (req, res) => {
  try {
    const symbol = (req.query.symbol || 'btc').toLowerCase();
    const timeframe = req.query.tf || '1m';
    const count = parseInt(req.query.count) || 100;
    
    if (!SUPPORTED_SYMBOLS.includes(symbol)) {
      return res.status(400).json({ ok: false, error: 'unsupported symbol' });
    }
    
    if (!ohlcCache) {
      return res.status(503).json({ ok: false, error: 'data layer not initialized' });
    }
    
    const bars = ohlcCache.getBars(symbol, timeframe, count);
    
    res.json({
      ok: true,
      symbol,
      timeframe,
      count: bars.length,
      bars
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET /api/metrics - Get data layer metrics
app.get('/api/metrics', (req, res) => {
  try {
    if (!ohlcCache) {
      return res.status(503).json({ ok: false, error: 'data layer not initialized' });
    }
    
    const cacheMetrics = ohlcCache.getMetrics();
    const wsStatus = binanceWS ? binanceWS.getStatus() : { enabled: false };
    
    res.json({
      ok: true,
      websocket: wsStatus,
      httpFallback: {
        enabled: HTTP_FALLBACK_ENABLED
      },
      cache: cacheMetrics,
      timestamp: Date.now()
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ========================================
// PACK 2 - STRATEGY ENGINE V2 API ENDPOINTS
// ========================================

// GET /api/plan-signal?symbol=btc&plan=short|mid|long
app.get('/api/plan-signal', async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'btc').toLowerCase();
    const plan = req.query.plan || 'mid';
    
    if (!SUPPORTED_SYMBOLS.includes(symbol)) {
      return res.status(400).json({ ok: false, error: 'unsupported symbol' });
    }
    
    if (!['short', 'mid', 'long'].includes(plan)) {
      return res.status(400).json({ ok: false, error: 'invalid plan. Use: short, mid, or long' });
    }
    
    if (!strategyEngine) {
      return res.status(503).json({ ok: false, error: 'strategy engine not initialized' });
    }
    
    const analysis = await strategyEngine.analyzeSymbol(symbol, plan);
    const time = new Date().toISOString();
    
    res.json({
      ok: true,
      symbol,
      plan,
      time,
      ...analysis
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ========================================
// PAPER TRADING API ENDPOINTS
// ========================================

// GET /api/paper/performance?strategy=day|swing|long - Get performance metrics
app.get('/api/paper/performance', async (req, res) => {
  try {
    const strategy = req.query.strategy;
    
    if (!Object.keys(paperTradingBots).length) {
      return res.status(503).json({ ok: false, error: 'paper trading not initialized' });
    }
    
    // If strategy specified, return only that one
    if (strategy && paperTradingBots[strategy]) {
      const performance = await paperTradingBots[strategy].getPerformance();
      return res.json({
        ok: true,
        strategy,
        ...performance
      });
    }
    
    // Otherwise return all strategies
    const allPerformance = {};
    for (const [name, bot] of Object.entries(paperTradingBots)) {
      allPerformance[name] = await bot.getPerformance();
    }
    
    res.json({
      ok: true,
      strategies: allPerformance
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET /api/paper/trades?strategy=day|swing|long&limit=50 - Get recent trades
app.get('/api/paper/trades', (req, res) => {
  try {
    const strategy = req.query.strategy;
    const limit = parseInt(req.query.limit) || 50;
    
    if (!Object.keys(paperTradingBots).length) {
      return res.status(503).json({ ok: false, error: 'paper trading not initialized' });
    }
    
    // If strategy specified, return only that one
    if (strategy && paperTradingBots[strategy]) {
      const trades = paperTradingBots[strategy].getTrades(limit);
      return res.json({
        ok: true,
        strategy,
        trades,
        count: trades.length
      });
    }
    
    // Otherwise return all strategies
    const allTrades = {};
    for (const [name, bot] of Object.entries(paperTradingBots)) {
      allTrades[name] = bot.getTrades(limit);
    }
    
    res.json({
      ok: true,
      strategies: allTrades
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET /api/paper/positions?strategy=day|swing|long - Get current open positions
app.get('/api/paper/positions', async (req, res) => {
  try {
    const strategy = req.query.strategy;
    
    if (!Object.keys(paperTradingBots).length) {
      return res.status(503).json({ ok: false, error: 'paper trading not initialized' });
    }
    
    // If strategy specified, return only that one
    if (strategy && paperTradingBots[strategy]) {
      const positions = await paperTradingBots[strategy].getPositions();
      return res.json({
        ok: true,
        strategy,
        positions,
        count: positions.length
      });
    }
    
    // Otherwise return all strategies
    const allPositions = {};
    for (const [name, bot] of Object.entries(paperTradingBots)) {
      allPositions[name] = await bot.getPositions();
    }
    
    res.json({
      ok: true,
      strategies: allPositions
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// --- Set Telegram Webhook ---
async function setTelegramWebhook() {
  if (!bot) {
    console.log('⚠️  Bot not initialized, skipping webhook setup');
    return;
  }
  
  try {
    const secretToken = process.env.WEBHOOK_SECRET || 'default-secret-change-me';
    const webhookUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`;
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        url: WEBHOOK_URL,
        secret_token: secretToken
      })
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log('✅ Webhook registered successfully!');
      console.log('   URL:', WEBHOOK_URL);
      console.log('   Telegram notifications: ENABLED');
    } else {
      console.error('❌ Failed to set webhook:', result.description);
    }
  } catch (error) {
    console.error('❌ Error setting webhook:', error.message);
  }
}

// Start background services after HTTP server is ready
async function startBackgroundServices() {
  console.log('\n🚀 Starting background services...\n');
  
  try {
    // Step 1: Initialize Pack 1 and wait for historical data
    console.log('📦 Step 1/3: Loading data layer...');
    await initializePack1();
    
    // Step 2: Initialize Pack 2 (synchronous, runs immediately after Pack 1)
    console.log('📦 Step 2/3: Initializing strategy engine...');
    initializePack2();
    
    // Step 3: Initialize Paper Trading (waits for portfolio file loading)
    console.log('📦 Step 3/3: Starting paper trading bots...');
    await initializePaperTrading();
    
    console.log('✅ All systems initialized and ready!\n');
    
    // Setup alert system
    console.log('🔔 Auto-Alert System Starting...');
    console.log(`Monitoring ${SUPPORTED_SYMBOLS.length} cryptocurrencies: ${SUPPORTED_SYMBOLS.join(', ').toUpperCase()}`);
    console.log(`Check interval: ${CHECK_INTERVAL_MS / 1000 / 60} minutes`);
    
    if (TELEGRAM_BOT_TOKEN) {
      console.log('✅ Telegram notifications: ENABLED (webhook mode)');
      await setTelegramWebhook();
    } else {
      console.log('🟡 Telegram notifications: DISABLED (console only)');
      console.log('   To enable: Set TELEGRAM_BOT_TOKEN in Secrets');
    }
    
    // Run initial signal check after 30 seconds (give systems time to warm up)
    setTimeout(() => {
      console.log('\n🔍 Running initial signal check...');
      checkSignals();
    }, 30000);
    
    // Then check every 10 minutes
    setInterval(() => {
      console.log('\n🔍 Running scheduled signal check...');
      checkSignals();
    }, CHECK_INTERVAL_MS);
    
    console.log('\n🎯 Server fully operational!');
    
  } catch (error) {
    console.error('\n❌ Fatal error during initialization:', error.message);
    console.error('Stack:', error.stack);
    console.error('\n⚠️  Server started but some features may not work correctly');
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server listening on http://0.0.0.0:${PORT}`);
  console.log('🩺 Health check ready at /healthz');
  
  // Start background services after server is ready (non-blocking)
  setImmediate(() => startBackgroundServices());
});