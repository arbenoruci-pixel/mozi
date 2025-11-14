// Strategy Engine v2 - Multi-indicator, multi-timeframe voting system
// Implements EMA, RSI, MACD, Bollinger Bands, and ATR across multiple timeframes

const { EMA, RSI, MACD, BollingerBands, ATR } = require('technicalindicators');

class StrategyEngine {
  constructor(ohlcCache) {
    this.ohlcCache = ohlcCache;
    
    // Timeframes to analyze
    this.timeframes = ['1m', '5m', '15m', '1h'];
    
    // Plan configurations (weights for each timeframe)
    this.plans = {
      short: { '1m': 0.4, '5m': 0.4, '15m': 0.15, '1h': 0.05 },  // Day trading
      mid: { '1m': 0.1, '5m': 0.35, '15m': 0.35, '1h': 0.2 },    // Swing trading
      long: { '1m': 0.05, '5m': 0.15, '15m': 0.3, '1h': 0.5 }    // Position trading
    };
    
    // ATR multipliers for SL/TP by plan
    this.atrMultipliers = {
      short: { sl: 1.0, tp: 1.5 },  // Tighter stops
      mid: { sl: 1.5, tp: 2.0 },
      long: { sl: 2.0, tp: 3.0 }    // Wider stops
    };
  }

  // Analyze a symbol across all timeframes
  async analyzeSymbol(symbol, plan = 'mid') {
    const results = {
      symbol,
      plan,
      timeframes: {},
      indicators: {},
      votes: {},
      confidence: 0,
      signal: 'HOLD',
      sltp: null
    };

    // Analyze each timeframe
    for (const tf of this.timeframes) {
      const tfAnalysis = this.analyzeTimeframe(symbol, tf);
      if (tfAnalysis) {
        results.timeframes[tf] = tfAnalysis;
      }
    }

    // Calculate weighted votes based on plan
    results.votes = this.calculateVotes(results.timeframes, plan);
    
    // Determine overall signal and confidence
    const { signal, confidence } = this.determineSignal(results.votes);
    results.signal = signal;
    results.confidence = confidence;

    // Calculate SL/TP if we have a signal
    if (signal !== 'HOLD' && results.timeframes['1h']) {
      results.sltp = this.calculateSLTP(
        results.timeframes['1h'].price,
        results.timeframes['1h'].atr,
        signal,
        plan
      );
    }

    // Aggregate indicators from primary timeframe (1h)
    if (results.timeframes['1h']) {
      results.indicators = {
        price: results.timeframes['1h'].price,
        rsi: results.timeframes['1h'].rsi,
        emas: results.timeframes['1h'].emas,
        macd: results.timeframes['1h'].macd,
        bb: results.timeframes['1h'].bb,
        atr: results.timeframes['1h'].atr
      };
    }

    return results;
  }

  // Analyze a single timeframe
  analyzeTimeframe(symbol, timeframe) {
    const bars = this.ohlcCache.getBars(symbol, timeframe, 200);
    
    if (bars.length < 50) {
      return null; // Not enough data
    }

    const closes = bars.map(b => b.close);
    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);

    // Calculate indicators
    const ema8 = EMA.calculate({ period: 8, values: closes });
    const ema21 = EMA.calculate({ period: 21, values: closes });
    const ema50 = EMA.calculate({ period: 50, values: closes });
    const ema200 = EMA.calculate({ period: 200, values: closes });
    
    const rsiVals = RSI.calculate({ period: 14, values: closes });
    
    const macdResult = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });
    
    const bbResult = BollingerBands.calculate({
      period: 20,
      values: closes,
      stdDev: 2
    });
    
    const atrResult = ATR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14
    });

    // Get latest values
    const latestIdx = closes.length - 1;
    const price = closes[latestIdx];
    const rsi = rsiVals[rsiVals.length - 1];
    const macd = macdResult[macdResult.length - 1];
    const bb = bbResult[bbResult.length - 1];
    const atr = atrResult[atrResult.length - 1];

    const emas = {
      ema8: ema8[ema8.length - 1],
      ema21: ema21[ema21.length - 1],
      ema50: ema50.length > 0 ? ema50[ema50.length - 1] : null,
      ema200: ema200.length > 0 ? ema200[ema200.length - 1] : null
    };

    // Evaluate each indicator
    const trend = this.evaluateTrend(emas);
    const rsiSignal = this.evaluateRSI(rsi);
    const macdSignal = this.evaluateMACD(macd);
    const bbSignal = this.evaluateBB(price, bb, rsi);

    return {
      timeframe,
      price,
      emas,
      rsi,
      macd,
      bb,
      atr,
      signals: { trend, rsiSignal, macdSignal, bbSignal }
    };
  }

  // Evaluate trend using EMAs
  evaluateTrend(emas) {
    const { ema8, ema21, ema50, ema200 } = emas;
    
    // Strong bullish: 8 > 21 > 50 > 200
    if (ema8 > ema21 && ema21 > (ema50 || ema21) && (ema50 || ema21) > (ema200 || ema50 || ema21)) {
      return { signal: 'BUY', strength: 1.0 };
    }
    
    // Strong bearish: 8 < 21 < 50 < 200
    if (ema8 < ema21 && ema21 < (ema50 || ema21) && (ema50 || ema21) < (ema200 || ema50 || ema21)) {
      return { signal: 'SELL', strength: 1.0 };
    }
    
    // Moderate bullish: 8 > 21
    if (ema8 > ema21) {
      return { signal: 'BUY', strength: 0.5 };
    }
    
    // Moderate bearish: 8 < 21
    if (ema8 < ema21) {
      return { signal: 'SELL', strength: 0.5 };
    }
    
    return { signal: 'HOLD', strength: 0 };
  }

  // Evaluate RSI
  evaluateRSI(rsi) {
    if (rsi > 60) {
      return { signal: 'BUY', strength: Math.min((rsi - 60) / 20, 1) };
    } else if (rsi < 40) {
      return { signal: 'SELL', strength: Math.min((40 - rsi) / 20, 1) };
    }
    return { signal: 'HOLD', strength: 0 };
  }

  // Evaluate MACD
  evaluateMACD(macd) {
    if (!macd) return { signal: 'HOLD', strength: 0 };
    
    const { MACD: macdLine, signal: signalLine, histogram } = macd;
    
    // MACD line above signal + positive histogram
    if (macdLine > signalLine && histogram > 0) {
      return { signal: 'BUY', strength: Math.min(histogram / Math.abs(macdLine) * 2, 1) };
    }
    
    // MACD line below signal + negative histogram
    if (macdLine < signalLine && histogram < 0) {
      return { signal: 'SELL', strength: Math.min(Math.abs(histogram) / Math.abs(macdLine) * 2, 1) };
    }
    
    return { signal: 'HOLD', strength: 0 };
  }

  // Evaluate Bollinger Bands with RSI filter
  evaluateBB(price, bb, rsi) {
    if (!bb) return { signal: 'HOLD', strength: 0 };
    
    const { upper, middle, lower } = bb;
    
    // Price below lower band + RSI < 40 = oversold
    if (price < lower && rsi < 40) {
      return { signal: 'BUY', strength: 0.8 };
    }
    
    // Price above upper band + RSI > 60 = overbought
    if (price > upper && rsi > 60) {
      return { signal: 'SELL', strength: 0.8 };
    }
    
    return { signal: 'HOLD', strength: 0 };
  }

  // Calculate weighted votes across timeframes
  calculateVotes(timeframes, plan) {
    const weights = this.plans[plan] || this.plans.mid;
    const votes = { BUY: 0, SELL: 0, HOLD: 0 };

    for (const [tf, data] of Object.entries(timeframes)) {
      const weight = weights[tf] || 0;
      const { signals } = data;

      // Aggregate signals from all indicators
      const tfVotes = { BUY: 0, SELL: 0, HOLD: 0 };
      
      for (const indicator of Object.values(signals)) {
        if (indicator.signal === 'BUY') {
          tfVotes.BUY += indicator.strength;
        } else if (indicator.signal === 'SELL') {
          tfVotes.SELL += indicator.strength;
        } else {
          tfVotes.HOLD += 0.1;
        }
      }

      // Apply timeframe weight
      votes.BUY += tfVotes.BUY * weight;
      votes.SELL += tfVotes.SELL * weight;
      votes.HOLD += tfVotes.HOLD * weight;
    }

    return votes;
  }

  // Determine overall signal and confidence
  determineSignal(votes) {
    const total = votes.BUY + votes.SELL + votes.HOLD;
    
    if (total === 0) {
      return { signal: 'HOLD', confidence: 0 };
    }

    const buyPct = (votes.BUY / total) * 100;
    const sellPct = (votes.SELL / total) * 100;

    // Require at least 40% consensus
    if (buyPct > 40 && buyPct > sellPct) {
      return { signal: 'BUY', confidence: Math.min(Math.round(buyPct), 100) };
    }
    
    if (sellPct > 40 && sellPct > buyPct) {
      return { signal: 'SELL', confidence: Math.min(Math.round(sellPct), 100) };
    }

    return { signal: 'HOLD', confidence: 0 };
  }

  // Calculate SL/TP based on ATR with fallback to percentage-based
  calculateSLTP(price, atr, signal, plan) {
    const multipliers = this.atrMultipliers[plan] || this.atrMultipliers.mid;
    
    // Minimum ATR threshold: 0.1% of price (prevents zero-width stops)
    const minATR = price * 0.001;
    
    // Fallback percentage-based stops if ATR too small
    const percentageFallback = {
      short: { sl: 0.02, tp: 0.05 },  // 2% stop, 5% take
      mid: { sl: 0.03, tp: 0.08 },    // 3% stop, 8% take
      long: { sl: 0.05, tp: 0.15 }    // 5% stop, 15% take
    };
    
    let stopLoss, takeProfit;
    
    // Use ATR-based if ATR is meaningful, otherwise use percentage-based
    const useATR = atr && atr >= minATR;
    
    if (signal === 'BUY') {
      if (useATR) {
        stopLoss = price - (atr * multipliers.sl);
        takeProfit = price + (atr * multipliers.tp);
      } else {
        const pct = percentageFallback[plan] || percentageFallback.mid;
        stopLoss = price * (1 - pct.sl);
        takeProfit = price * (1 + pct.tp);
      }
    } else if (signal === 'SELL') {
      if (useATR) {
        stopLoss = price + (atr * multipliers.sl);
        takeProfit = price - (atr * multipliers.tp);
      } else {
        const pct = percentageFallback[plan] || percentageFallback.mid;
        stopLoss = price * (1 + pct.sl);
        takeProfit = price * (1 - pct.tp);
      }
    } else {
      return null;
    }
    
    // Validate minimum distance (at least 0.5% from entry)
    const minDistance = price * 0.005;
    if (Math.abs(stopLoss - price) < minDistance) {
      stopLoss = signal === 'BUY' ? price * 0.98 : price * 1.02;
    }
    if (Math.abs(takeProfit - price) < minDistance) {
      takeProfit = signal === 'BUY' ? price * 1.05 : price * 0.95;
    }

    return { stopLoss, takeProfit };
  }
}

module.exports = StrategyEngine;
