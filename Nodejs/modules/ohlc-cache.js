// OHLC Cache Module - In-memory cache for candlestick data
// Maintains rolling window of OHLC bars for multiple timeframes

class OHLCCache {
  constructor(maxBars = 500) {
    this.maxBars = maxBars;
    this.cache = {}; // { symbol: { '1m': [...bars], '5m': [...bars] } }
    this.lastTick = {}; // { symbol: { price, time, source } }
    this.errors = {}; // { symbol: count }
    
    // Initialize cache for all symbols
    this.symbols = ['btc', 'eth', 'sol', 'xrp', 'ada', 'doge', 'bnb', 'ltc', 'matic', 'avax', 'dot', 'link'];
    this.timeframes = ['1m', '5m', '15m', '1h'];
    
    this.symbols.forEach(symbol => {
      this.cache[symbol] = {};
      this.timeframes.forEach(tf => {
        this.cache[symbol][tf] = [];
      });
      this.lastTick[symbol] = { price: null, time: null, source: null };
      this.errors[symbol] = 0;
    });
    
    // Current incomplete candles
    this.currentCandles = {}; // { symbol: { '1m': {...}, '5m': {...} } }
    this.symbols.forEach(symbol => {
      this.currentCandles[symbol] = {};
      this.timeframes.forEach(tf => {
        this.currentCandles[symbol][tf] = null;
      });
    });
  }

  // Update price tick from WebSocket or HTTP
  updateTick(symbol, price, source = 'ws', timestamp = null) {
    const now = timestamp || Date.now();
    this.lastTick[symbol] = { price, time: now, source };
    
    // Update all timeframes
    this.timeframes.forEach(tf => {
      this.updateOHLC(symbol, tf, price, now);
    });
  }

  // Update OHLC for a specific timeframe
  updateOHLC(symbol, timeframe, price, timestamp) {
    const tfMs = this.getTimeframeMs(timeframe);
    const candleStart = Math.floor(timestamp / tfMs) * tfMs;
    
    const current = this.currentCandles[symbol][timeframe];
    
    // Check if we need to close the current candle and start a new one
    if (!current || current.time !== candleStart) {
      // Close previous candle if exists
      if (current) {
        this.addCompletedCandle(symbol, timeframe, current);
      }
      
      // Start new candle
      this.currentCandles[symbol][timeframe] = {
        time: candleStart,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0
      };
    } else {
      // Update current candle
      current.high = Math.max(current.high, price);
      current.low = Math.min(current.low, price);
      current.close = price;
    }
  }

  // Add completed candle to cache
  addCompletedCandle(symbol, timeframe, candle) {
    const cache = this.cache[symbol][timeframe];
    cache.push(candle);
    
    // Keep only last maxBars
    if (cache.length > this.maxBars) {
      cache.shift();
    }
  }

  // Get OHLC bars for a symbol and timeframe
  getBars(symbol, timeframe = '1m', count = 100) {
    if (!this.cache[symbol] || !this.cache[symbol][timeframe]) {
      return [];
    }
    
    const bars = this.cache[symbol][timeframe];
    return bars.slice(-count);
  }

  // Get latest price
  getLatestPrice(symbol) {
    return this.lastTick[symbol];
  }

  // Get symbols with stale data (not updated recently)
  getStaleSymbols(maxAgeMs = 120000) {
    const now = Date.now();
    const stale = [];
    
    this.symbols.forEach(symbol => {
      const tick = this.lastTick[symbol];
      if (!tick.time || (now - tick.time) > maxAgeMs) {
        stale.push(symbol);
      }
    });
    
    return stale;
  }

  // Get metrics for monitoring
  getMetrics() {
    const metrics = {
      symbols: {},
      totalBars: 0,
      lastUpdate: Date.now()
    };
    
    this.symbols.forEach(symbol => {
      const tick = this.lastTick[symbol];
      metrics.symbols[symbol] = {
        lastPrice: tick.price,
        lastTick: tick.time,
        source: tick.source,
        errors: this.errors[symbol] || 0,
        bars: {}
      };
      
      this.timeframes.forEach(tf => {
        const count = this.cache[symbol][tf].length;
        metrics.symbols[symbol].bars[tf] = count;
        metrics.totalBars += count;
      });
    });
    
    return metrics;
  }

  // Increment error counter
  recordError(symbol) {
    this.errors[symbol] = (this.errors[symbol] || 0) + 1;
  }

  // Convert timeframe string to milliseconds
  getTimeframeMs(tf) {
    const map = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000
    };
    return map[tf] || 60 * 1000;
  }

  // Bulk load historical bars (for initialization or backfill)
  loadHistoricalBars(symbol, timeframe, bars) {
    if (!this.cache[symbol] || !this.cache[symbol][timeframe]) {
      return;
    }
    
    // Add bars and keep only last maxBars
    this.cache[symbol][timeframe] = bars.slice(-this.maxBars);
    
    // Set lastTick to most recent bar's close price
    if (bars.length > 0) {
      const lastBar = bars[bars.length - 1];
      this.lastTick[symbol] = {
        price: lastBar.close,
        time: lastBar.time || Date.now(),
        source: 'historical'
      };
    }
    
    console.log(`[OHLC] Loaded ${bars.length} ${timeframe} bars for ${symbol.toUpperCase()}`);
  }
}

module.exports = OHLCCache;
