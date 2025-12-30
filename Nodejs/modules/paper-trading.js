const fs = require('fs').promises;
const path = require('path');

class PaperTrading {
  constructor(strategyEngine, config = {}) {
    this.strategyEngine = strategyEngine;
    this.strategyName = config.strategyName || 'day';
    this.dataFile = path.join(__dirname, '..', `paper-portfolio-${this.strategyName}.json`);
    
    this.config = {
      initialBalance: config.initialBalance || 1000,
      positionSize: config.positionSize || 0.10,
      maxPositions: config.maxPositions || 3,
      stopLossPct: config.stopLossPct || 0.02,
      takeProfitPct: config.takeProfitPct || 0.05,
      plan: config.plan || 'short',
      challengeDuration: config.challengeDuration || '1 week',
      ...config
    };
    
    this.telegramBot = config.telegramBot || null;
    this.telegramChatId = config.telegramChatId || null;
    this.portfolio = null;
  }

  async sendTelegramNotification(message) {
    if (!this.telegramBot || !this.telegramChatId) {
      return;
    }

    try {
      await this.telegramBot.sendMessage(this.telegramChatId, message, { parse_mode: 'HTML' });
      console.log('📱 Telegram notification sent');
    } catch (error) {
      console.error('❌ Failed to send Telegram notification:', error.message);
    }
  }

  async initialize() {
    try {
      const data = await fs.readFile(this.dataFile, 'utf8');
      this.portfolio = JSON.parse(data);
      console.log('📊 Paper portfolio loaded:', {
        balance: this.portfolio.balance,
        positions: this.portfolio.positions.length,
        trades: this.portfolio.trades.length
      });
    } catch (error) {
      console.log('📊 Creating new paper trading portfolio...');
      this.portfolio = {
        balance: this.config.initialBalance,
        initialBalance: this.config.initialBalance,
        positions: [],
        trades: [],
        metrics: {
          totalTrades: 0,
          wins: 0,
          losses: 0,
          totalProfit: 0,
          totalLoss: 0,
          winRate: 0,
          avgWin: 0,
          avgLoss: 0,
          profitFactor: 0,
          maxDrawdown: 0,
          peakBalance: this.config.initialBalance
        },
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await this.save();
    }
  }

  async save() {
    this.portfolio.updatedAt = new Date().toISOString();
    await fs.writeFile(this.dataFile, JSON.stringify(this.portfolio, null, 2));
  }

  async checkAndExecuteTrades(symbols) {
    if (!this.portfolio) {
      await this.initialize();
    }

    const actions = [];

    for (const symbol of symbols) {
      const analysis = await this.strategyEngine.analyzeSymbol(symbol, this.config.plan);
      
      if (!analysis || !analysis.indicators || !analysis.indicators.price) {
        continue;
      }

      const currentPrice = analysis.indicators.price;
      const signal = analysis.signal;
      const confidence = analysis.confidence;

      const existingPosition = this.portfolio.positions.find(p => p.symbol === symbol);

      if (existingPosition) {
        const action = await this.checkExitConditions(existingPosition, currentPrice, signal, confidence);
        if (action) actions.push(action);
      } else {
        const action = await this.checkEntryConditions(symbol, currentPrice, signal, confidence, analysis.sltp);
        if (action) actions.push(action);
      }
    }

    if (actions.length > 0) {
      await this.save();
    }

    return actions;
  }

  async checkEntryConditions(symbol, price, signal, confidence, sltp) {
    if (signal === 'HOLD' || confidence < 50) {
      return null;
    }

    if (this.portfolio.positions.length >= this.config.maxPositions) {
      return null;
    }

    if (signal !== 'BUY') {
      return null;
    }

    const positionValue = this.portfolio.balance * this.config.positionSize;
    const quantity = positionValue / price;

    if (positionValue > this.portfolio.balance) {
      return null;
    }

    // Use strategy-provided SL/TP or calculate percentage-based
    let stopLoss = sltp && sltp.stopLoss ? sltp.stopLoss : price * (1 - this.config.stopLossPct);
    let takeProfit = sltp && sltp.takeProfit ? sltp.takeProfit : price * (1 + this.config.takeProfitPct);
    
    // CRITICAL: Enforce strategy-specific minimum percentages
    const minStopLossPct = Math.max(this.config.stopLossPct, 0.02);  // At least 2%
    const minTakeProfitPct = Math.max(this.config.takeProfitPct, 0.05);  // At least 5%
    
    // Validate and fix stop-loss (check percentage, not just distance)
    const slDistancePct = stopLoss ? Math.abs(stopLoss - price) / price : 0;
    if (!stopLoss || slDistancePct < minStopLossPct) {
      stopLoss = price * (1 - minStopLossPct);
      console.warn(`⚠️  ${symbol.toUpperCase()} SL too close (${(slDistancePct * 100).toFixed(2)}%), enforcing ${(minStopLossPct * 100).toFixed(1)}% = $${stopLoss.toFixed(4)}`);
    }
    
    // Validate and fix take-profit (check percentage, not just distance)
    const tpDistancePct = takeProfit ? Math.abs(takeProfit - price) / price : 0;
    if (!takeProfit || tpDistancePct < minTakeProfitPct) {
      takeProfit = price * (1 + minTakeProfitPct);
      console.warn(`⚠️  ${symbol.toUpperCase()} TP too close (${(tpDistancePct * 100).toFixed(2)}%), enforcing ${(minTakeProfitPct * 100).toFixed(1)}% = $${takeProfit.toFixed(4)}`);
    }
    
    // Final sanity check: Ensure SL < entry < TP for LONG positions
    if (stopLoss >= price) {
      stopLoss = price * 0.98;
      console.error(`🚨 ${symbol.toUpperCase()} SL >= entry! Force-setting to $${stopLoss.toFixed(4)}`);
    }
    if (takeProfit <= price) {
      takeProfit = price * 1.05;
      console.error(`🚨 ${symbol.toUpperCase()} TP <= entry! Force-setting to $${takeProfit.toFixed(4)}`);
    }

    const position = {
      symbol,
      side: 'LONG',
      entryPrice: price,
      quantity,
      positionValue,
      stopLoss,
      takeProfit,
      confidence,
      entryTime: new Date().toISOString(),
      entryReason: `${signal} signal with ${confidence}% confidence`
    };

    this.portfolio.positions.push(position);
    this.portfolio.balance -= positionValue;

    const trade = {
      id: `${symbol}-${Date.now()}`,
      symbol,
      side: 'LONG',
      action: 'ENTRY',
      price,
      quantity,
      value: positionValue,
      confidence,
      balance: this.portfolio.balance,
      timestamp: new Date().toISOString(),
      reason: position.entryReason
    };

    this.portfolio.trades.push(trade);

    console.log(`✅ PAPER BUY: ${symbol.toUpperCase()} @ $${price.toFixed(2)} (${confidence}% confidence)`);

    // Send Telegram notification
    const strategyLabel = this.strategyName.toUpperCase();
    const strategyEmoji = this.strategyName === 'day' ? '⚡' : this.strategyName === 'swing' ? '📊' : '🛡️';
    
    const buyMessage = `🤖 <b>PAPER TRADING BOT</b> 💰\n` +
      `${strategyEmoji} <b>${strategyLabel} TRADING</b> (${this.config.challengeDuration})\n\n` +
      `✅ <b>BUY EXECUTED</b>\n` +
      `📊 Symbol: <b>${symbol.toUpperCase()}</b>\n` +
      `💵 Entry Price: <b>$${price.toFixed(2)}</b>\n` +
      `📈 Quantity: <b>${quantity.toFixed(6)}</b>\n` +
      `💰 Position Size: <b>$${positionValue.toFixed(2)}</b>\n` +
      `🎯 Confidence: <b>${confidence}%</b>\n` +
      `🛑 Stop-Loss: <b>$${stopLoss.toFixed(2)}</b> (-${(this.config.stopLossPct * 100).toFixed(1)}%)\n` +
      `🎯 Take-Profit: <b>$${takeProfit.toFixed(2)}</b> (+${(this.config.takeProfitPct * 100).toFixed(1)}%)\n` +
      `💼 Balance Left: <b>$${this.portfolio.balance.toFixed(2)}</b>`;
    
    await this.sendTelegramNotification(buyMessage);

    return {
      type: 'ENTRY',
      symbol,
      price,
      quantity,
      confidence,
      stopLoss,
      takeProfit
    };
  }

  async checkExitConditions(position, currentPrice, signal, confidence) {
    let exitReason = null;
    
    // Calculate actual profit/loss to avoid premature exits
    const currentValue = position.quantity * currentPrice;
    const profitLoss = currentValue - position.positionValue;
    const profitLossPct = (profitLoss / position.positionValue) * 100;

    // Stop-loss: Only trigger if actually below stop AND showing loss
    if (currentPrice <= position.stopLoss && profitLossPct < -0.1) {
      exitReason = `Stop-loss hit at $${currentPrice.toFixed(2)}`;
    } 
    // Take-profit: Only trigger if actually above target AND showing profit
    else if (currentPrice >= position.takeProfit && profitLossPct > 0.1) {
      exitReason = `Take-profit hit at $${currentPrice.toFixed(2)}`;
    } 
    // SELL signal: Only if strong confidence and not in immediate loss
    else if (signal === 'SELL' && confidence >= 50) {
      exitReason = `SELL signal with ${confidence}% confidence`;
    }

    if (!exitReason) {
      return null;
    }

    const exitValue = position.quantity * currentPrice;
    const profit = exitValue - position.positionValue;
    const profitPct = (profit / position.positionValue) * 100;

    this.portfolio.balance += exitValue;

    const positionIndex = this.portfolio.positions.indexOf(position);
    this.portfolio.positions.splice(positionIndex, 1);

    const trade = {
      id: `${position.symbol}-${Date.now()}`,
      symbol: position.symbol,
      side: position.side,
      action: 'EXIT',
      entryPrice: position.entryPrice,
      exitPrice: currentPrice,
      quantity: position.quantity,
      entryValue: position.positionValue,
      exitValue,
      profit,
      profitPct,
      balance: this.portfolio.balance,
      timestamp: new Date().toISOString(),
      reason: exitReason,
      holdTime: this.calculateHoldTime(position.entryTime)
    };

    this.portfolio.trades.push(trade);

    await this.updateMetrics(profit);

    const emoji = profit >= 0 ? '✅' : '❌';
    console.log(`${emoji} PAPER SELL: ${position.symbol.toUpperCase()} @ $${currentPrice.toFixed(2)} | P/L: $${profit.toFixed(2)} (${profitPct.toFixed(2)}%)`);

    // Send Telegram notification
    const profitEmoji = profit >= 0 ? '💰' : '📉';
    const resultEmoji = profit >= 0 ? '✅' : '❌';
    const strategyLabel = this.strategyName.toUpperCase();
    const strategyEmoji = this.strategyName === 'day' ? '⚡' : this.strategyName === 'swing' ? '📊' : '🛡️';
    
    const sellMessage = `🤖 <b>PAPER TRADING BOT</b> 💰\n` +
      `${strategyEmoji} <b>${strategyLabel} TRADING</b> (${this.config.challengeDuration})\n\n` +
      `${resultEmoji} <b>SELL EXECUTED</b>\n` +
      `📊 Symbol: <b>${position.symbol.toUpperCase()}</b>\n` +
      `💵 Entry Price: <b>$${position.entryPrice.toFixed(2)}</b>\n` +
      `💵 Exit Price: <b>$${currentPrice.toFixed(2)}</b>\n` +
      `📈 Quantity: <b>${position.quantity.toFixed(6)}</b>\n` +
      `${profitEmoji} <b>Profit/Loss: $${profit.toFixed(2)} (${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(2)}%)</b>\n` +
      `⏱ Hold Time: <b>${this.calculateHoldTime(position.entryTime)}</b>\n` +
      `📝 Reason: <i>${exitReason}</i>\n` +
      `💼 New Balance: <b>$${this.portfolio.balance.toFixed(2)}</b>\n` +
      `📊 Total Return: <b>${((this.portfolio.balance / this.config.initialBalance - 1) * 100).toFixed(2)}%</b>`;
    
    await this.sendTelegramNotification(sellMessage);

    return {
      type: 'EXIT',
      symbol: position.symbol,
      entryPrice: position.entryPrice,
      exitPrice: currentPrice,
      profit,
      profitPct,
      reason: exitReason
    };
  }

  calculateHoldTime(entryTime) {
    const entry = new Date(entryTime);
    const now = new Date();
    const diffMs = now - entry;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 60) return `${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d`;
  }

  async updateMetrics(profit) {
    const m = this.portfolio.metrics;
    
    m.totalTrades++;
    
    if (profit > 0) {
      m.wins++;
      m.totalProfit += profit;
    } else {
      m.losses++;
      m.totalLoss += Math.abs(profit);
    }
    
    m.winRate = m.totalTrades > 0 ? (m.wins / m.totalTrades) * 100 : 0;
    m.avgWin = m.wins > 0 ? m.totalProfit / m.wins : 0;
    m.avgLoss = m.losses > 0 ? m.totalLoss / m.losses : 0;
    m.profitFactor = m.totalLoss > 0 ? m.totalProfit / m.totalLoss : 0;

    await this.refreshPeakAndDrawdown();
  }

  async refreshPeakAndDrawdown() {
    const m = this.portfolio.metrics;
    const totalValue = await this.getTotalValue();
    
    if (totalValue > m.peakBalance) {
      m.peakBalance = totalValue;
    }
    
    const drawdown = m.peakBalance > 0 ? ((m.peakBalance - totalValue) / m.peakBalance) * 100 : 0;
    if (drawdown > m.maxDrawdown) {
      m.maxDrawdown = drawdown;
    }
  }

  async getTotalValue() {
    let total = this.portfolio.balance;
    
    for (const pos of this.portfolio.positions) {
      const currentPrice = await this.getCurrentPrice(pos.symbol);
      if (currentPrice) {
        total += pos.quantity * currentPrice;
      } else {
        total += pos.positionValue;
      }
    }
    
    return total;
  }

  async getCurrentPrice(symbol) {
    try {
      const analysis = await this.strategyEngine.analyzeSymbol(symbol, this.config.plan);
      return analysis && analysis.indicators && analysis.indicators.price ? analysis.indicators.price : null;
    } catch (e) {
      return null;
    }
  }

  async getPerformance() {
    await this.refreshPeakAndDrawdown();
    
    const totalValue = await this.getTotalValue();
    const totalReturn = totalValue - this.portfolio.initialBalance;
    const totalReturnPct = (totalReturn / this.portfolio.initialBalance) * 100;

    return {
      balance: this.portfolio.balance,
      positionsValue: totalValue - this.portfolio.balance,
      totalValue,
      initialBalance: this.portfolio.initialBalance,
      totalReturn,
      totalReturnPct,
      positions: this.portfolio.positions.length,
      metrics: this.portfolio.metrics,
      startedAt: this.portfolio.startedAt,
      updatedAt: this.portfolio.updatedAt
    };
  }

  getTrades(limit = 50) {
    return this.portfolio.trades.slice(-limit).reverse();
  }

  async getPositions() {
    const enrichedPositions = [];
    
    for (const pos of this.portfolio.positions) {
      const currentPrice = await this.getCurrentPrice(pos.symbol);
      const enriched = { ...pos };
      
      if (currentPrice) {
        enriched.currentPrice = currentPrice;
        enriched.currentValue = pos.quantity * currentPrice;
        enriched.unrealizedPnL = enriched.currentValue - pos.positionValue;
        enriched.unrealizedPnLPct = (enriched.unrealizedPnL / pos.positionValue) * 100;
      }
      
      enrichedPositions.push(enriched);
    }
    
    return enrichedPositions;
  }
}

module.exports = PaperTrading;
