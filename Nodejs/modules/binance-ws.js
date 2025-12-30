// Binance WebSocket Module - Real-time price stream
// Connects to Binance WebSocket API for live price updates

const WebSocket = require('ws');

class BinanceWS {
  constructor(ohlcCache, config = {}) {
    this.ohlcCache = ohlcCache;
    this.enabled = config.enabled !== false;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000; // Start with 1 second
    this.isConnected = false;
    this.lastPingTime = null;
    
    // Symbol mapping (lowercase to Binance format)
    this.symbolMap = {
      'btc': 'BTCUSDT',
      'eth': 'ETHUSDT',
      'sol': 'SOLUSDT',
      'xrp': 'XRPUSDT',
      'ada': 'ADAUSDT',
      'doge': 'DOGEUSDT',
      'bnb': 'BNBUSDT',
      'ltc': 'LTCUSDT',
      'matic': 'MATICUSDT',
      'avax': 'AVAXUSDT',
      'dot': 'DOTUSDT',
      'link': 'LINKUSDT'
    };
    
    this.symbols = Object.keys(this.symbolMap);
  }

  // Start WebSocket connection
  connect() {
    if (!this.enabled) {
      console.log('[Binance WS] WebSocket disabled via config');
      return;
    }

    // Build stream URL for all symbols (combined stream)
    const streams = this.symbols
      .map(sym => `${this.symbolMap[sym].toLowerCase()}@trade`)
      .join('/');
    
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
    
    console.log(`[Binance WS] Connecting to Binance WebSocket...`);
    console.log(`[Binance WS] Monitoring ${this.symbols.length} symbols`);
    
    try {
      this.ws = new WebSocket(url);
      
      this.ws.on('open', () => this.onOpen());
      this.ws.on('message', (data) => this.onMessage(data));
      this.ws.on('error', (error) => this.onError(error));
      this.ws.on('close', () => this.onClose());
      this.ws.on('ping', () => this.onPing());
      
    } catch (error) {
      console.error('[Binance WS] Failed to create WebSocket:', error.message);
      this.scheduleReconnect();
    }
  }

  onOpen() {
    console.log('[Binance WS] ✅ Connected to Binance');
    this.isConnected = true;
    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;
    this.lastPingTime = Date.now();
  }

  onMessage(data) {
    try {
      const message = JSON.parse(data);
      
      // Binance combined stream format: { stream: "btcusdt@trade", data: {...} }
      if (message.stream && message.data) {
        this.handleTrade(message);
      }
    } catch (error) {
      console.error('[Binance WS] Error parsing message:', error.message);
    }
  }

  handleTrade(message) {
    try {
      const stream = message.stream;
      const data = message.data;
      
      // Extract symbol from stream name (e.g., "btcusdt@trade" -> "btc")
      const binanceSymbol = stream.split('@')[0].toUpperCase();
      const symbol = this.getSymbolFromBinance(binanceSymbol);
      
      if (!symbol) {
        return; // Unknown symbol
      }
      
      // Extract price from trade data
      const price = parseFloat(data.p);
      
      if (!isNaN(price) && price > 0) {
        // Update OHLC cache
        this.ohlcCache.updateTick(symbol, price, 'ws');
      }
      
    } catch (error) {
      console.error('[Binance WS] Error handling trade:', error.message);
    }
  }

  onError(error) {
    console.error('[Binance WS] Error:', error.message);
    this.isConnected = false;
  }

  onClose() {
    console.log('[Binance WS] Connection closed');
    this.isConnected = false;
    this.scheduleReconnect();
  }

  onPing() {
    this.lastPingTime = Date.now();
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Binance WS] Max reconnection attempts reached. Giving up.');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
    
    console.log(`[Binance WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  getSymbolFromBinance(binanceSymbol) {
    for (const [key, value] of Object.entries(this.symbolMap)) {
      if (value === binanceSymbol) {
        return key;
      }
    }
    return null;
  }

  // Close connection
  disconnect() {
    if (this.ws) {
      console.log('[Binance WS] Disconnecting...');
      this.enabled = false;
      this.ws.close();
      this.ws = null;
    }
  }

  // Get connection status
  getStatus() {
    return {
      enabled: this.enabled,
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      lastPing: this.lastPingTime,
      uptime: this.lastPingTime ? Date.now() - this.lastPingTime : null
    };
  }
}

module.exports = BinanceWS;
