'use strict';

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, 'data', 'portfolio.json');
const STARTING_CASH = 100000;

function defaultPortfolio() {
  return {
    startingCash: STARTING_CASH,
    cash: STARTING_CASH,
    positions: {},      // { SYMBOL: { shares, avgCost, currentPrice } }
    trades: [],         // trade history
    snapshots: [],      // daily performance snapshots
    lastUpdated: null,
    lastRunDate: null,
    spyStartPrice: null, // SPY price on first trading day (for indexing)
    marketSummary: '',
  };
}

function load() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      const raw = fs.readFileSync(DATA_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[portfolio] Failed to load portfolio.json, starting fresh:', err.message);
  }
  return defaultPortfolio();
}

function save(portfolio) {
  portfolio.lastUpdated = new Date().toISOString();
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(portfolio, null, 2), 'utf8');
}

// Sum of (shares × currentPrice) across all positions
function getPositionsValue(portfolio) {
  return Object.values(portfolio.positions).reduce((sum, pos) => {
    return sum + pos.shares * (pos.currentPrice || pos.avgCost);
  }, 0);
}

function getTotalValue(portfolio) {
  return portfolio.cash + getPositionsValue(portfolio);
}

// Update currentPrice for all held positions from a priceMap { SYMBOL: priceData }
function updatePrices(portfolio, priceMap) {
  for (const [symbol, pos] of Object.entries(portfolio.positions)) {
    const data = priceMap[symbol];
    if (data && data.price) {
      pos.currentPrice = data.price;
    }
  }
}

// Execute a BUY trade
function buy(portfolio, symbol, shares, price, reasoning) {
  const cost = shares * price;
  if (cost > portfolio.cash) {
    console.warn(`[portfolio] BUY ${symbol} rejected — insufficient cash ($${portfolio.cash.toFixed(2)} < $${cost.toFixed(2)})`);
    return false;
  }

  if (!portfolio.positions[symbol]) {
    portfolio.positions[symbol] = { shares: 0, avgCost: 0, currentPrice: price };
  }
  const pos = portfolio.positions[symbol];
  const totalShares = pos.shares + shares;
  pos.avgCost = (pos.shares * pos.avgCost + cost) / totalShares;
  pos.shares = totalShares;
  pos.currentPrice = price;
  portfolio.cash -= cost;

  portfolio.trades.push({
    date: todayStr(),
    symbol,
    action: 'BUY',
    shares,
    price,
    cost: Math.round(cost * 100) / 100,
    reasoning: reasoning || '',
    timestamp: new Date().toISOString(),
  });

  return true;
}

// Execute a SELL trade
function sell(portfolio, symbol, shares, price, reasoning) {
  const pos = portfolio.positions[symbol];
  if (!pos || pos.shares < shares) {
    console.warn(`[portfolio] SELL ${symbol} rejected — not enough shares (have ${pos?.shares || 0}, want ${shares})`);
    return false;
  }

  const proceeds = shares * price;
  pos.shares -= shares;
  pos.currentPrice = price;

  if (pos.shares === 0) {
    delete portfolio.positions[symbol];
  }

  portfolio.cash += proceeds;

  portfolio.trades.push({
    date: todayStr(),
    symbol,
    action: 'SELL',
    shares,
    price,
    proceeds: Math.round(proceeds * 100) / 100,
    reasoning: reasoning || '',
    timestamp: new Date().toISOString(),
  });

  return true;
}

// Record daily portfolio vs benchmark snapshot
function takeSnapshot(portfolio, spyPrice) {
  const totalValue = getTotalValue(portfolio);

  // On first snapshot, record SPY starting price for indexed comparison
  if (!portfolio.spyStartPrice && spyPrice) {
    portfolio.spyStartPrice = spyPrice;
  }

  // Index SPY value to $100k start
  const spyIndexedValue = portfolio.spyStartPrice && spyPrice
    ? (spyPrice / portfolio.spyStartPrice) * STARTING_CASH
    : null;

  const snapshot = {
    date: todayStr(),
    portfolioValue: Math.round(totalValue * 100) / 100,
    cash: Math.round(portfolio.cash * 100) / 100,
    spyPrice: spyPrice || null,
    spyIndexedValue: spyIndexedValue ? Math.round(spyIndexedValue * 100) / 100 : null,
    pnl: Math.round((totalValue - STARTING_CASH) * 100) / 100,
    pnlPercent: Math.round(((totalValue - STARTING_CASH) / STARTING_CASH) * 10000) / 100,
    timestamp: new Date().toISOString(),
  };

  // Avoid duplicate snapshots for the same day
  portfolio.snapshots = portfolio.snapshots.filter(s => s.date !== snapshot.date);
  portfolio.snapshots.push(snapshot);
  // Keep last 365 days
  if (portfolio.snapshots.length > 365) portfolio.snapshots = portfolio.snapshots.slice(-365);

  return snapshot;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Return a rich summary object for the API
function getSummary(portfolio) {
  const totalValue = getTotalValue(portfolio);
  const pnl = totalValue - STARTING_CASH;
  const pnlPercent = (pnl / STARTING_CASH) * 100;
  const latestSnapshot = portfolio.snapshots[portfolio.snapshots.length - 1] || null;

  const positions = Object.entries(portfolio.positions).map(([symbol, pos]) => {
    const currentValue = pos.shares * (pos.currentPrice || pos.avgCost);
    const costBasis = pos.shares * pos.avgCost;
    const positionPnl = currentValue - costBasis;
    const positionPnlPct = costBasis ? (positionPnl / costBasis) * 100 : 0;
    return {
      symbol,
      shares: pos.shares,
      avgCost: Math.round(pos.avgCost * 100) / 100,
      currentPrice: Math.round((pos.currentPrice || pos.avgCost) * 100) / 100,
      currentValue: Math.round(currentValue * 100) / 100,
      pnl: Math.round(positionPnl * 100) / 100,
      pnlPercent: Math.round(positionPnlPct * 100) / 100,
    };
  });

  return {
    startingCash: STARTING_CASH,
    cash: Math.round(portfolio.cash * 100) / 100,
    positionsValue: Math.round(getPositionsValue(portfolio) * 100) / 100,
    totalValue: Math.round(totalValue * 100) / 100,
    pnl: Math.round(pnl * 100) / 100,
    pnlPercent: Math.round(pnlPercent * 100) / 100,
    positions,
    recentTrades: portfolio.trades.slice(-20).reverse(),
    latestSnapshot,
    lastRunDate: portfolio.lastRunDate,
    lastUpdated: portfolio.lastUpdated,
    marketSummary: portfolio.marketSummary || '',
  };
}

module.exports = { load, save, buy, sell, updatePrices, takeSnapshot, getTotalValue, getSummary };
