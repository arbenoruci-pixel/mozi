// Data Feed Manager - Unified price feed using KuCoin WebSocket + CoinGecko batch fallback
// Optimized for free tier usage

const WebSocket = require('ws');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');

class DataFeedManager {
  constructor(ohlcCache, config = {}) {
    this.ohlcCache = ohlcCache;
    this.enabled = config.enabled !== false;
    
    // Symbol mapping
    this.symbols = ['btc', 'eth', 'sol', 'xrp', 'ada', 'doge', 'bnb', 'ltc', 'matic', 'avax', 'dot', 'link'];
    
    this.kucoinSymbolMap = {
      'btc': 'BTC-USDT',
      'eth': 'ETH-USDT',
      'sol': 'SOL-USDT',
      'xrp': 'XRP-USDT',
      'ada': 'ADA-USDT',
      'doge': 'DOGE-USDT',
      'bnb': 'BNB-USDT',
      'ltc': 'LTC-USDT',
      'matic': 'POL-USDT', // MATIC rebranded to POL on KuCoin
      'avax': 'AVAX-USDT',
      'dot': 'DOT-USDT',
      'link': 'LINK-USDT'
    };
    
    this.coinGeckoMap = {
      'btc': 'bitcoin',
      'eth': 'ethereum',
      'sol': 'solana',
      'xrp': 'ripple',
      'ada': 'cardano',
      'doge': 'dogecoin',
      'bnb': 'binancecoin',
      'ltc': 'litecoin',
      'matic': 'matic-network',
      'avax': 'avalanche-2',
      'dot': 'polkadot',
      'link': 'chainlink'
    };
    
    // WebSocket state
    this.ws = null;
    this.wsReconnectDelay = 5000;
    this.wsReconnectAttempts = 0;
    this.wsMaxReconnectAttempts = 10;
    this.pingInterval = null;
    this.wsConnected = false;
    this.tokenRenewalInterval = null;
    this.wsConnectedAt = null;
    
    // Fallback REST API state
    this.fallbackInterval = null;
    this.fallbackIntervalMs = 120000; // 2 minutes (conservative for free tier)
    this.lastFallbackFetch = 0;
    this.minFallbackInterval = 60000; // Minimum 60 seconds between batched calls
    
    // Disk persistence
    this.cacheDir = path.join(process.cwd(), '.cache');
    this.historicalFile = path.join(this.cacheDir, 'historical-ohlc.json');
    
    // Rate limiting
    this.requestQueue = [];
    this.processing = false;
    this.requestsPerMinute = 40; // Conservative limit for CoinGecko free tier
    this.requestTimestamps = [];
  }

  async initialize() {
    if (!this.enabled) {
      console.log('[DataFeed] Disabled, skipping initialization');
      return;
    }

    console.log('[DataFeed] Initializing multi-source price feed...');
    
    // Create cache directory
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      console.error('[DataFeed] Error creating cache directory:', error.message);
    }
    
    // Load persisted historical data
    await this.loadHistoricalCache();
    
    // Fetch fresh historical data if cache is empty
    const needsHistorical = await this.checkIfNeedsHistoricalData();
    if (needsHistorical) {
      console.log('[DataFeed] Fetching historical data from KuCoin...');
      await this.fetchHistoricalData();
    }
    
    // Start KuCoin WebSocket connection
    await this.connectKuCoinWebSocket();
    
    // Start fallback REST API (for when WebSocket fails)
    this.startFallbackPolling();
    
    console.log('[DataFeed] Initialization complete');
  }

  // === KuCoin WebSocket Implementation ===
  
  async connectKuCoinWebSocket() {
    try {
      console.log('[KuCoin WS] Requesting connection token...');
      
      // Get WebSocket token (no auth needed for public channels)
      const response = await fetch('https://api.kucoin.com/api/v1/bullet-public', {
        method: 'POST'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.code !== '200000') {
        throw new Error(data.msg || 'Failed to get token');
      }
      
      const token = data.data.token;
      const endpoint = data.data.instanceServers[0].endpoint;
      const wsUrl = `${endpoint}?token=${token}`;
      
      console.log('[KuCoin WS] Connecting to WebSocket...');
      
      // Create WebSocket connection
      this.ws = new WebSocket(wsUrl);
      
      this.ws.on('open', () => this.onWebSocketOpen());
      this.ws.on('message', (data) => this.onWebSocketMessage(data));
      this.ws.on('error', (error) => this.onWebSocketError(error));
      this.ws.on('close', () => this.onWebSocketClose());
      
    } catch (error) {
      console.error('[KuCoin WS] Connection error:', error.message);
      this.scheduleReconnect();
    }
  }

  onWebSocketOpen() {
    console.log('✅ [KuCoin WS] Connected successfully');
    this.wsConnected = true;
    this.wsReconnectAttempts = 0;
    this.wsConnectedAt = Date.now();
    
    // Subscribe to all tickers in one subscription
    const subscribeMsg = {
      id: Date.now(),
      type: 'subscribe',
      topic: '/market/ticker:all',
      privateChannel: false,
      response: true
    };
    
    this.ws.send(JSON.stringify(subscribeMsg));
    console.log('[KuCoin WS] Subscribed to all market tickers');
    
    // Start ping to keep connection alive
    this.startPing();
    
    // Schedule token renewal (KuCoin tokens expire after 24h)
    this.scheduleTokenRenewal();
  }

  onWebSocketMessage(data) {
    try {
      const message = JSON.parse(data);
      
      // Handle welcome message
      if (message.type === 'welcome') {
        console.log('[KuCoin WS] Received welcome message');
        return;
      }
      
      // Handle pong response
      if (message.type === 'pong') {
        return;
      }
      
      // Handle ticker updates
      if (message.type === 'message' && message.topic === '/market/ticker:all') {
        this.handleTickerUpdate(message);
      }
      
    } catch (error) {
      console.error('[KuCoin WS] Message parse error:', error.message);
    }
  }

  handleTickerUpdate(message) {
    const symbol = message.subject; // e.g., "BTC-USDT"
    
    // KuCoin /market/ticker:all provides bestAsk/bestBid, not always price
    // Use the best ask price as the current price (most reliable for all-tickers feed)
    const price = parseFloat(message.data.bestAsk || message.data.price || message.data.bestBid);
    
    // Find our internal symbol name
    const ourSymbol = Object.keys(this.kucoinSymbolMap).find(
      key => this.kucoinSymbolMap[key] === symbol
    );
    
    if (ourSymbol && price && !isNaN(price)) {
      this.ohlcCache.updateTick(ourSymbol, price, 'kucoin-ws');
      // Log every 100th tick to verify WebSocket is working (avoid spam)
      if (!this.tickCount) this.tickCount = {};
      this.tickCount[ourSymbol] = (this.tickCount[ourSymbol] || 0) + 1;
      if (this.tickCount[ourSymbol] % 100 === 1) {
        console.log(`[KuCoin WS] ${ourSymbol.toUpperCase()}: ${this.tickCount[ourSymbol]} ticks received, latest price: ${price}`);
      }
    }
  }

  onWebSocketError(error) {
    console.error('[KuCoin WS] Error:', error.message);
  }

  onWebSocketClose() {
    console.log('[KuCoin WS] Connection closed');
    this.wsConnected = false;
    this.stopPing();
    this.stopTokenRenewal();
    this.scheduleReconnect();
  }

  startPing() {
    // Send ping every 30 seconds to keep connection alive
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const pingMsg = {
          id: Date.now(),
          type: 'ping'
        };
        this.ws.send(JSON.stringify(pingMsg));
      }
    }, 30000);
  }

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
  
  scheduleTokenRenewal() {
    // Renew WebSocket connection every 12 hours (tokens last 24h)
    this.tokenRenewalInterval = setInterval(() => {
      const uptime = Date.now() - this.wsConnectedAt;
      console.log(`[KuCoin WS] Renewing connection after ${Math.floor(uptime / 3600000)}h uptime`);
      
      // Close existing connection
      if (this.ws) {
        this.ws.close();
      }
      
      // Reconnect with fresh token
      this.connectKuCoinWebSocket();
    }, 12 * 3600 * 1000); // 12 hours
  }
  
  stopTokenRenewal() {
    if (this.tokenRenewalInterval) {
      clearInterval(this.tokenRenewalInterval);
      this.tokenRenewalInterval = null;
    }
  }

  scheduleReconnect() {
    if (this.wsReconnectAttempts >= this.wsMaxReconnectAttempts) {
      console.error('[KuCoin WS] Max reconnect attempts reached, giving up');
      return;
    }
    
    this.wsReconnectAttempts++;
    const delay = this.wsReconnectDelay * Math.pow(2, Math.min(this.wsReconnectAttempts - 1, 5));
    
    console.log(`[KuCoin WS] Reconnecting in ${delay / 1000}s (attempt ${this.wsReconnectAttempts}/${this.wsMaxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connectKuCoinWebSocket();
    }, delay);
  }

  // === Historical Data Fetching ===
  
  async checkIfNeedsHistoricalData() {
    // Check if we have enough 1h bars (we're fetching 1h candles now)
    for (const symbol of this.symbols.slice(0, 3)) { // Check first 3 symbols
      const bars = this.ohlcCache.getBars(symbol, '1h', 200);
      if (bars && bars.length >= 200) {
        console.log('[DataFeed] Found cached historical data (1h bars)');
        return false; // We have data
      }
    }
    return true; // Need to fetch
  }
  
  async fetchHistoricalData() {
    console.log('[DataFeed] Fetching historical candles for all timeframes...');
    console.log('[DataFeed] This will fetch 1m, 5m, 15m, and 1h bars for complete coverage');
    
    const timeframes = [
      { type: '1min', key: '1m', count: 500, name: '1-minute' },
      { type: '5min', key: '5m', count: 500, name: '5-minute' },
      { type: '15min', key: '15m', count: 400, name: '15-minute' },
      { type: '1hour', key: '1h', count: 300, name: '1-hour' }
    ];
    
    const delayMs = 400; // 400ms between requests
    let totalFetched = 0;
    
    for (const symbol of this.symbols) {
      const kucoinSymbol = this.kucoinSymbolMap[symbol];
      console.log(`[KuCoin] Fetching all timeframes for ${symbol.toUpperCase()}...`);
      
      for (const tf of timeframes) {
        try {
          await this.delay(delayMs);
          
          const url = `https://api.kucoin.com/api/v1/market/candles?type=${tf.type}&symbol=${kucoinSymbol}&startAt=${Math.floor(Date.now() / 1000) - (tf.count * this.getTimeframeSeconds(tf.key))}`;
          
          const response = await fetch(url);
          
          if (!response.ok) {
            console.warn(`[KuCoin] Failed ${symbol} ${tf.key}: HTTP ${response.status}`);
            continue;
          }
          
          const data = await response.json();
          
          if (data.code === '200000' && Array.isArray(data.data)) {
            const candles = data.data.reverse(); // Oldest first
            
            const bars = candles.map(candle => ({
              time: parseInt(candle[0]) * 1000,
              open: parseFloat(candle[1]),
              close: parseFloat(candle[2]),
              high: parseFloat(candle[3]),
              low: parseFloat(candle[4]),
              volume: parseFloat(candle[5])
            })).filter(bar => !isNaN(bar.close));
            
            this.ohlcCache.loadHistoricalBars(symbol, tf.key, bars);
            totalFetched++;
          }
          
        } catch (error) {
          console.error(`[KuCoin] Error fetching ${symbol} ${tf.key}:`, error.message);
        }
      }
    }
    
    console.log(`[DataFeed] Historical data fetch complete: ${totalFetched} timeframes loaded`);
    
    // Save to disk
    if (totalFetched > 0) {
      await this.saveHistoricalCache();
    }
  }
  
  getTimeframeSeconds(tf) {
    const map = {
      '1m': 60,
      '5m': 300,
      '15m': 900,
      '1h': 3600
    };
    return map[tf] || 60;
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // === CoinGecko Batch Fallback ===
  
  startFallbackPolling() {
    console.log(`[CoinGecko] Starting batch fallback (every ${this.fallbackIntervalMs / 1000}s)`);
    
    // Initial fetch
    setTimeout(() => {
      this.fetchBatchPrices();
    }, 5000);
    
    // Periodic fetch
    this.fallbackInterval = setInterval(() => {
      this.fetchBatchPrices();
    }, this.fallbackIntervalMs);
  }

  async fetchBatchPrices() {
    const now = Date.now();
    
    // Rate limit check
    if (now - this.lastFallbackFetch < this.minFallbackInterval) {
      return;
    }
    
    try {
      // Batch request for all 12 cryptocurrencies in ONE API call
      const coinIds = this.symbols.map(s => this.coinGeckoMap[s]).join(',');
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd&include_24hr_vol=true`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        if (response.status === 429) {
          console.warn('[CoinGecko] Rate limited, will retry later');
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      this.lastFallbackFetch = now;
      
      // Update cache with all prices
      let successCount = 0;
      for (const symbol of this.symbols) {
        const coinId = this.coinGeckoMap[symbol];
        const price = data[coinId]?.usd;
        
        if (price && !isNaN(price)) {
          this.ohlcCache.updateTick(symbol, price, 'coingecko');
          successCount++;
        }
      }
      
      const timestamp = new Date().toLocaleTimeString();
      console.log(`[CoinGecko] [${timestamp}] Batch updated ${successCount}/${this.symbols.length} prices`);
      
    } catch (error) {
      console.error('[CoinGecko] Batch fetch error:', error.message);
    }
  }

  // === Disk Persistence ===
  
  async loadHistoricalCache() {
    try {
      const data = await fs.readFile(this.historicalFile, 'utf8');
      const cached = JSON.parse(data);
      
      console.log('[DataFeed] Loading historical data from cache...');
      
      let loadedCount = 0;
      for (const symbol of this.symbols) {
        if (cached[symbol]) {
          const timeframes = ['1m', '5m', '15m', '1h'];
          for (const tf of timeframes) {
            if (cached[symbol][tf] && Array.isArray(cached[symbol][tf])) {
              this.ohlcCache.loadHistoricalBars(symbol, tf, cached[symbol][tf]);
              loadedCount++;
            }
          }
        }
      }
      
      console.log(`[DataFeed] Loaded ${loadedCount} timeframe caches from disk`);
      
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[DataFeed] Error loading cache:', error.message);
      }
      console.log('[DataFeed] No cached data found, will fetch fresh');
    }
  }

  async saveHistoricalCache() {
    try {
      const cacheData = {};
      
      for (const symbol of this.symbols) {
        cacheData[symbol] = {};
        const timeframes = ['1m', '5m', '15m', '1h'];
        
        for (const tf of timeframes) {
          const bars = this.ohlcCache.getBars(symbol, tf, 500);
          if (bars && bars.length > 0) {
            cacheData[symbol][tf] = bars;
          }
        }
      }
      
      await fs.writeFile(this.historicalFile, JSON.stringify(cacheData), 'utf8');
      console.log('[DataFeed] Historical data saved to disk');
      
    } catch (error) {
      console.error('[DataFeed] Error saving cache:', error.message);
    }
  }

  // === Cleanup ===
  
  async shutdown() {
    console.log('[DataFeed] Shutting down...');
    
    // Save cache before shutdown
    await this.saveHistoricalCache();
    
    // Close WebSocket
    if (this.ws) {
      this.ws.close();
    }
    
    // Stop intervals
    this.stopPing();
    this.stopTokenRenewal();
    
    if (this.fallbackInterval) {
      clearInterval(this.fallbackInterval);
    }
    
    console.log('[DataFeed] Shutdown complete');
  }
}

module.exports = DataFeedManager;
