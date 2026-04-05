'use strict';

const portfolio = require('./portfolio');
const marketData = require('./market-data');
const aiEngine = require('./ai-engine');
const { FICTIONAL_STOCKS } = require('./fictional-stocks');

let isRunning = false;
let lastRunResult = null;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function runDailyTradingCycle({ force = false } = {}) {
  if (isRunning) {
    console.log('[bot] Trading cycle already running, skipping.');
    return { success: false, error: 'Already running' };
  }

  const state = portfolio.load();

  if (!force && state.lastRunDate === todayStr()) {
    console.log('[bot] Trading cycle already ran today, skipping.');
    return { success: false, error: 'Already ran today', alreadyRan: true };
  }

  isRunning = true;
  console.log(`\n[bot] ═══ Daily Trading Cycle — ${todayStr()} ═══`);

  try {
    // 1. Fetch all market prices
    console.log('[bot] Step 1/5 — Fetching market data...');
    const priceMap = await marketData.fetchAllPrices();
    const fetchedCount = Object.keys(priceMap).length;
    console.log(`[bot] Fetched prices for ${fetchedCount} tickers`);

    if (fetchedCount === 0) {
      throw new Error('No market data available — all fetches failed');
    }

    // 2. Mark-to-market existing positions
    console.log('[bot] Step 2/5 — Updating position prices...');
    portfolio.updatePrices(state, priceMap);

    // 3. Get AI trade decisions
    console.log('[bot] Step 3/5 — Consulting AI for trade decisions...');
    let decisions = [];
    let marketSummary = '';

    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('[bot] ANTHROPIC_API_KEY not set — skipping AI decisions, no trades executed');
      marketSummary = 'AI trading disabled — ANTHROPIC_API_KEY not configured.';
    } else {
      const result = await aiEngine.getTradeDecisions(state, priceMap);
      decisions = result.decisions;
      marketSummary = result.marketSummary;
      console.log(`[bot] AI returned ${decisions.length} trade decision(s)`);
      console.log(`[bot] Market summary: ${marketSummary}`);
    }

    // 4. Execute trades
    console.log('[bot] Step 4/5 — Executing trades...');
    let tradesExecuted = 0;
    const tradeResults = [];

    for (const decision of decisions) {
      const { symbol, action, shares, reasoning } = decision;
      const priceData = priceMap[symbol];

      if (!priceData || !priceData.price) {
        console.warn(`[bot] Skipping ${action} ${symbol} — no price data`);
        tradeResults.push({ symbol, action, shares, success: false, reason: 'No price data' });
        continue;
      }

      const price = priceData.price;

      // Safety check: max 25% of total portfolio per position
      const totalValue = portfolio.getTotalValue(state);
      const maxPositionValue = totalValue * 0.25;

      if (action === 'BUY') {
        const currentPos = state.positions[symbol];
        const currentValue = currentPos ? currentPos.shares * (currentPos.currentPrice || currentPos.avgCost) : 0;
        const additionalValue = shares * price;
        if (currentValue + additionalValue > maxPositionValue) {
          const maxNewShares = Math.floor((maxPositionValue - currentValue) / price);
          if (maxNewShares < 1) {
            console.warn(`[bot] BUY ${symbol} capped — position already at 25% limit`);
            tradeResults.push({ symbol, action, shares, success: false, reason: 'Position limit reached' });
            continue;
          }
          console.warn(`[bot] BUY ${symbol} capped from ${shares} to ${maxNewShares} shares (25% position limit)`);
          decision.shares = maxNewShares;
        }

        // Maintain $5,000 cash reserve
        const cashAfterBuy = state.cash - (decision.shares * price);
        if (cashAfterBuy < 5000) {
          const affordableShares = Math.floor((state.cash - 5000) / price);
          if (affordableShares < 1) {
            console.warn(`[bot] BUY ${symbol} skipped — insufficient cash after reserve`);
            tradeResults.push({ symbol, action, shares: decision.shares, success: false, reason: 'Insufficient cash' });
            continue;
          }
          console.warn(`[bot] BUY ${symbol} adjusted to ${affordableShares} shares (cash reserve)`);
          decision.shares = affordableShares;
        }
      }

      let success;
      if (action === 'BUY') {
        success = portfolio.buy(state, symbol, decision.shares, price, reasoning);
      } else if (action === 'SELL') {
        success = portfolio.sell(state, symbol, decision.shares, price, reasoning);
      } else {
        success = false;
      }

      if (success) {
        tradesExecuted++;
        console.log(`[bot] ✓ ${action} ${decision.shares} ${symbol} @ $${price}`);
      } else {
        console.warn(`[bot] ✗ ${action} ${decision.shares} ${symbol} — rejected`);
      }

      tradeResults.push({ symbol, action, shares: decision.shares, price, success, reasoning });
    }

    // 5. Take daily snapshot
    console.log('[bot] Step 5/5 — Recording daily snapshot...');
    const spyData = priceMap['SPY'];
    const spyPrice = spyData?.price || null;
    const snapshot = portfolio.takeSnapshot(state, spyPrice);

    state.lastRunDate = todayStr();
    state.marketSummary = marketSummary;
    portfolio.save(state);

    const result = {
      success: true,
      date: todayStr(),
      tradesExecuted,
      tradeResults,
      portfolioValue: snapshot.portfolioValue,
      pnl: snapshot.pnl,
      pnlPercent: snapshot.pnlPercent,
      spyPrice,
      spyIndexedValue: snapshot.spyIndexedValue,
      marketSummary,
    };

    lastRunResult = result;
    console.log(`[bot] ═══ Cycle complete — portfolio value: $${snapshot.portfolioValue.toLocaleString()} | P&L: ${snapshot.pnlPercent >= 0 ? '+' : ''}${snapshot.pnlPercent}% ═══\n`);
    return result;

  } catch (err) {
    console.error('[bot] Trading cycle failed:', err.message);
    lastRunResult = { success: false, error: err.message, date: todayStr() };
    return lastRunResult;
  } finally {
    isRunning = false;
  }
}

function getStatus() {
  return {
    isRunning,
    lastRunResult,
    lastRunDate: lastRunResult?.date || null,
  };
}

module.exports = { runDailyTradingCycle, getStatus };
