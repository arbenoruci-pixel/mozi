// HTTP Fallback Module - Fetches price data from CoinGecko API when WebSocket is down
// Implements exponential backoff retry logic

const fetch = require('node-fetch');

class HTTPFallback {
  constructor(ohlcCache, config = {}) {
    this.ohlcCache = ohlcCache;
    this.enabled = config.enabled !== false;
    this.baseUrl = 'https://api.coingecko.com/api/v3';
    
    // Symbol mapping (CoinGecko IDs)
    this.symbolMap = {
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
    
    this.symbols = Object.keys(this.symbolMap);
    
    // Rate limiting
    this.lastFetchTime = {};
    this.minFetchInterval = 2000; // 2 seconds between requests per symbol
    
    // Retry config
    this.maxRetries = 3;
    this.baseDelay = 1000; // 1 second
    this.maxDelay = 30000; // 30 seconds
    
    // Auto-refresh
    this.refreshInterval = null;
    this.refreshIntervalMs = 60000; // 60 seconds
    this.refreshDelayBetweenSymbols = 300; // 300ms between symbols
  }

  // Fetch current price with retry logic (CoinGecko API)
  async fetchPrice(symbol, retryCount = 0) {
    if (!this.enabled) {
      return null;
    }

    const coinId = this.symbolMap[symbol];
    if (!coinId) {
      return null;
    }

    // Rate limiting check
    const now = Date.now();
    const lastFetch = this.lastFetchTime[symbol] || 0;
    if (now - lastFetch < this.minFetchInterval) {
      return null; // Too soon, skip this fetch
    }

    try {
      const url = `${this.baseUrl}/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_vol=true`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      const price = data[coinId]?.usd;
      
      if (price && !isNaN(price)) {
        this.lastFetchTime[symbol] = now;
        this.ohlcCache.updateTick(symbol, price, 'http');
        return price;
      }
      
      return null;
      
    } catch (error) {
      console.error(`[CoinGecko] Error fetching ${symbol}:`, error.message);
      this.ohlcCache.recordError(symbol);
      
      // Retry with exponential backoff
      if (retryCount < this.maxRetries) {
        const delay = Math.min(
          this.baseDelay * Math.pow(2, retryCount),
          this.maxDelay
        );
        
        console.log(`[CoinGecko] Retrying ${symbol} in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.fetchPrice(symbol, retryCount + 1);
      }
      
      return null;
    }
  }

  // Fetch historical OHLC data for backfilling cache (Bybit v5 Klines API)
  async fetchHistoricalOHLC(symbol, timeframe = '1m', limit = 500) {
    if (!this.enabled) {
      return [];
    }

    const bybitSymbol = this.symbolMap[symbol];
    if (!bybitSymbol) {
      return [];
    }

    try {
      // Map timeframe to Bybit interval format
      const interval = this.getBybitInterval(timeframe);
      const url = `${this.baseUrl}/market/kline?category=spot&symbol=${bybitSymbol}&interval=${interval}&limit=${limit}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.retCode !== 0) {
        throw new Error(data.retMsg || 'API error');
      }
      
      const klines = data.result?.list;
      
      if (!Array.isArray(klines) || klines.length === 0) {
        return [];
      }
      
      // Convert Bybit klines to our OHLC format
      // Bybit format: [timestamp, open, high, low, close, volume, turnover]
      const bars = klines.map(kline => ({
        time: parseInt(kline[0]), // Timestamp in ms
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4]),
        volume: parseFloat(kline[5])
      })).reverse(); // Bybit returns newest first, we need oldest first
      
      return bars;
      
    } catch (error) {
      console.error(`[Bybit] Error fetching historical ${symbol} ${timeframe}:`, error.message);
      return [];
    }
  }

  getBybitInterval(timeframe) {
    const map = {
      '1m': '1',
      '5m': '5',
      '15m': '15',
      '1h': '60',
      '1d': 'D'
    };
    return map[timeframe] || '1';
  }

  // Fetch all symbols (for periodic refresh when WS is down)
  async fetchAllPrices() {
    const results = {};
    
    for (const symbol of this.symbols) {
      const price = await this.fetchPrice(symbol);
      if (price) {
        results[symbol] = price;
      }
      // Small delay between requests to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    return results;
  }

  // Initialize cache by backfilling historical data
  async initializeCache() {
    if (!this.enabled) {
      console.log('[Bybit] Disabled, skipping cache initialization');
      return;
    }

    console.log('[Bybit] Initializing OHLC cache with historical data...');
    
    for (const symbol of this.symbols) {
      try {
        // Fetch 1m bars
        const bars1m = await this.fetchHistoricalOHLC(symbol, '1m', 500);
        if (bars1m.length > 0) {
          this.ohlcCache.loadHistoricalBars(symbol, '1m', bars1m);
          
          // Aggregate to 5m
          const bars5m = this.aggregate1mTo5m(bars1m);
          this.ohlcCache.loadHistoricalBars(symbol, '5m', bars5m);
          
          // Aggregate to 15m
          const bars15m = this.aggregate1mToNm(bars1m, 15);
          this.ohlcCache.loadHistoricalBars(symbol, '15m', bars15m);
        }
        
        // Fetch hourly bars separately (more efficient)
        const bars1h = await this.fetchHistoricalOHLC(symbol, '1h', 500);
        if (bars1h.length > 0) {
          this.ohlcCache.loadHistoricalBars(symbol, '1h', bars1h);
        }
        
        // Small delay between symbols to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.error(`[Bybit] Error initializing ${symbol}:`, error.message);
      }
    }
    
    console.log('[Bybit] Cache initialization complete');
  }

  // Generic aggregation from 1m bars to Nm bars
  aggregate1mToNm(bars1m, n) {
    const barsNm = [];
    
    for (let i = 0; i < bars1m.length; i += n) {
      const chunk = bars1m.slice(i, i + n);
      if (chunk.length === 0) continue;
      
      const barNm = {
        time: chunk[0].time,
        open: chunk[0].open,
        high: Math.max(...chunk.map(b => b.high)),
        low: Math.min(...chunk.map(b => b.low)),
        close: chunk[chunk.length - 1].close,
        volume: chunk.reduce((sum, b) => sum + (b.volume || 0), 0)
      };
      
      barsNm.push(barNm);
    }
    
    return barsNm;
  }

  // Aggregate 1m bars into 5m bars
  aggregate1mTo5m(bars1m) {
    const bars5m = [];
    
    for (let i = 0; i < bars1m.length; i += 5) {
      const chunk = bars1m.slice(i, i + 5);
      if (chunk.length === 0) continue;
      
      const bar5m = {
        time: chunk[0].time,
        open: chunk[0].open,
        high: Math.max(...chunk.map(b => b.high)),
        low: Math.min(...chunk.map(b => b.low)),
        close: chunk[chunk.length - 1].close,
        volume: chunk.reduce((sum, b) => sum + b.volume, 0)
      };
      
      bars5m.push(bar5m);
    }
    
    return bars5m;
  }

  // Fetch all prices sequentially
  async fetchAllPrices() {
    const results = [];
    
    for (const symbol of this.symbols) {
      try {
        const price = await this.fetchPrice(symbol);
        if (price) {
          results.push({ symbol, price, success: true });
        }
        // Delay between symbols to respect rate limits
        await new Promise(resolve => setTimeout(resolve, this.refreshDelayBetweenSymbols));
      } catch (error) {
        console.error(`[Bybit] Error refreshing ${symbol}:`, error.message);
        results.push({ symbol, success: false, error: error.message });
      }
    }
    
    return results;
  }

  // Start auto-refresh loop
  startAutoRefresh() {
    if (!this.enabled) {
      console.log('[Bybit] Auto-refresh not started (disabled)');
      return;
    }

    if (this.refreshInterval) {
      console.log('[Bybit] Auto-refresh already running');
      return;
    }

    console.log(`[Bybit] Starting auto-refresh (every ${this.refreshIntervalMs / 1000}s)`);

    this.refreshInterval = setInterval(async () => {
      try {
        const timestamp = new Date().toLocaleTimeString();
        const results = await this.fetchAllPrices();
        const successCount = results.filter(r => r.success).length;
        
        if (successCount > 0) {
          console.log(`[Bybit] [${timestamp}] Refreshed ${successCount}/${this.symbols.length} symbols`);
        }
        
        // Stale data warning
        const staleSymbols = this.ohlcCache.getStaleSymbols(this.refreshIntervalMs * 2);
        if (staleSymbols.length > 0) {
          console.warn(`⚠️ [Bybit] Stale data detected for: ${staleSymbols.join(', ')}`);
        }
      } catch (error) {
        console.error('[Bybit] Auto-refresh error:', error.message);
      }
    }, this.refreshIntervalMs);

    // Run first refresh immediately
    setImmediate(async () => {
      console.log('[Bybit] Running initial price refresh...');
      await this.fetchAllPrices();
    });
  }

  // Stop auto-refresh loop
  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      console.log('[Bybit] Auto-refresh stopped');
    }
  }
}

module.exports = HTTPFallback;
