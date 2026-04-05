'use strict';

const fetch = require('node-fetch');
const { FICTIONAL_STOCKS, WORLD_INDICES } = require('./fictional-stocks');

// In-memory price cache: realTicker → { data, expiresAt }
const priceCache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

function getCachedPrice(ticker) {
  const entry = priceCache.get(ticker);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { priceCache.delete(ticker); return null; }
  return entry.data;
}

function setCachedPrice(ticker, data) {
  priceCache.set(ticker, { data, expiresAt: Date.now() + CACHE_TTL });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch price from Yahoo Finance (no API key required)
async function fetchYahooPrice(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)',
      'Accept': 'application/json',
    },
    timeout: 10000,
  });
  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status} for ${ticker}`);
  const json = await res.json();

  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No data in Yahoo Finance response for ${ticker}`);

  const meta = result.meta;
  const price = meta.regularMarketPrice || meta.previousClose;
  const prevClose = meta.previousClose || meta.chartPreviousClose;
  const change = price - prevClose;
  const changePercent = prevClose ? (change / prevClose) * 100 : 0;

  // Extract recent daily closes for trend context
  const closes = result.indicators?.quote?.[0]?.close || [];
  const recentCloses = closes.filter(Boolean).slice(-5);

  return {
    ticker,
    price: Math.round(price * 100) / 100,
    prevClose: Math.round(prevClose * 100) / 100,
    change: Math.round(change * 100) / 100,
    changePercent: Math.round(changePercent * 100) / 100,
    high: Math.round((meta.regularMarketDayHigh || price) * 100) / 100,
    low: Math.round((meta.regularMarketDayLow || price) * 100) / 100,
    volume: meta.regularMarketVolume || 0,
    recentCloses,
    stale: false,
    source: 'yahoo',
  };
}

// Fallback: Alpha Vantage (requires ALPHA_VANTAGE_KEY in .env)
async function fetchAlphaVantagePrice(ticker) {
  const key = process.env.ALPHA_VANTAGE_KEY;
  if (!key) throw new Error('ALPHA_VANTAGE_KEY not set');

  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${key}`;
  const res = await fetch(url, { timeout: 10000 });
  if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status} for ${ticker}`);
  const json = await res.json();

  const q = json['Global Quote'];
  if (!q || !q['05. price']) throw new Error(`No Alpha Vantage data for ${ticker}`);

  const price = parseFloat(q['05. price']);
  const prevClose = parseFloat(q['08. previous close']);
  const change = parseFloat(q['09. change']);
  const changePercent = parseFloat(q['10. change percent'].replace('%', ''));

  return {
    ticker,
    price: Math.round(price * 100) / 100,
    prevClose: Math.round(prevClose * 100) / 100,
    change: Math.round(change * 100) / 100,
    changePercent: Math.round(changePercent * 100) / 100,
    high: parseFloat(q['03. high']),
    low: parseFloat(q['04. low']),
    volume: parseInt(q['06. volume'], 10),
    recentCloses: [],
    stale: false,
    source: 'alphavantage',
  };
}

// Fetch a single ticker with cache, Yahoo primary, Alpha Vantage fallback
async function fetchPrice(ticker) {
  const cached = getCachedPrice(ticker);
  if (cached) return cached;

  let data;
  try {
    data = await fetchYahooPrice(ticker);
  } catch (yahooErr) {
    console.warn(`[market-data] Yahoo failed for ${ticker}: ${yahooErr.message}`);
    try {
      data = await fetchAlphaVantagePrice(ticker);
    } catch (avErr) {
      console.warn(`[market-data] Alpha Vantage also failed for ${ticker}: ${avErr.message}`);
      // Return a stale cached entry if available (even expired)
      const stale = priceCache.get(ticker);
      if (stale) return { ...stale.data, stale: true };
      return null;
    }
  }

  setCachedPrice(ticker, data);
  return data;
}

// Fetch prices for all fictional stocks + world indices sequentially (rate limit friendly)
async function fetchAllPrices() {
  const allTickers = [
    ...FICTIONAL_STOCKS.map(s => ({ ticker: s.realTicker, symbol: s.symbol })),
    ...WORLD_INDICES.map(i => ({ ticker: i.ticker, symbol: i.ticker })),
  ];

  const results = {}; // keyed by fictional symbol or index ticker

  for (const { ticker, symbol } of allTickers) {
    const data = await fetchPrice(ticker);
    if (data) results[symbol] = data;
    await sleep(300); // be polite to free APIs
  }

  return results;
}

// Get cached or fresh price for a single fictional stock symbol
async function getPriceForSymbol(symbol) {
  const { FICTIONAL_STOCKS: stocks } = require('./fictional-stocks');
  const stock = stocks.find(s => s.symbol === symbol);
  if (!stock) return null;
  return fetchPrice(stock.realTicker);
}

module.exports = { fetchAllPrices, fetchPrice, getPriceForSymbol, priceCache };
