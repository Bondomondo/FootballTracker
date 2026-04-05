require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_FOOTBALL_KEY || '';
const API_HOST = 'v3.football.api-sports.io';
const API_BASE = `https://${API_HOST}`;

// Simple in-memory cache to protect free plan quota
// Key: cache key string, Value: { data, expiresAt }
const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data, ttlMs) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// TTL constants (longer TTL = fewer API calls)
const TTL = {
  SEARCH: 24 * 60 * 60 * 1000,       // 24h  – team search rarely changes
  FIXTURES: 60 * 60 * 1000,           // 1h   – recent fixtures
  STANDINGS: 6 * 60 * 60 * 1000,      // 6h   – standings
  STATISTICS: 6 * 60 * 60 * 1000,     // 6h   – team stats
};

async function apiFetch(endpoint, params = {}) {
  if (!API_KEY) {
    throw new Error('API_FOOTBALL_KEY is not set. Add it to your .env file.');
  }

  const url = new URL(`${API_BASE}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const cacheKey = url.toString();
  const ttl = endpoint === 'teams'
    ? TTL.SEARCH
    : endpoint === 'standings'
    ? TTL.STANDINGS
    : endpoint.includes('statistics')
    ? TTL.STATISTICS
    : TTL.FIXTURES;

  const cached = getCached(cacheKey);
  if (cached) return cached;

  const res = await fetch(url.toString(), {
    headers: {
      'x-rapidapi-host': API_HOST,
      'x-rapidapi-key': API_KEY,
    },
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length > 0) {
    throw new Error(JSON.stringify(json.errors));
  }

  setCache(cacheKey, json, ttl);
  return json;
}

app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ──────────────────────────────────────────────────────────────

// Search teams by name
app.get('/api/teams/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 3) return res.json({ response: [] });
  try {
    const data = await apiFetch('teams', { search: q });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fixtures for a team in the current season (free plan only supports team+season)
app.get('/api/fixtures/recent', async (req, res) => {
  const { teamId } = req.query;
  if (!teamId) return res.status(400).json({ error: 'teamId required' });
  // Free plan only supports seasons 2022–2024; use the most recent available
  const season = 2024;
  try {
    const data = await apiFetch('fixtures', { team: teamId, season });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Standings for a league + season
app.get('/api/standings', async (req, res) => {
  const { leagueId, season } = req.query;
  if (!leagueId || !season) return res.status(400).json({ error: 'leagueId and season required' });
  try {
    const data = await apiFetch('standings', { league: leagueId, season });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Team statistics
app.get('/api/teams/statistics', async (req, res) => {
  const { teamId, leagueId, season } = req.query;
  if (!teamId || !leagueId || !season) {
    return res.status(400).json({ error: 'teamId, leagueId, and season required' });
  }
  try {
    const data = await apiFetch('teams/statistics', {
      team: teamId,
      league: leagueId,
      season,
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cache stats (for debugging / transparency)
app.get('/api/cache/stats', (_req, res) => {
  res.json({ entries: cache.size });
});

app.listen(PORT, () => {
  console.log(`Football Tracker running at http://localhost:${PORT}`);
  if (!API_KEY) {
    console.warn('⚠  API_FOOTBALL_KEY not set – add it to .env before making requests.');
  }
});

// ── Trading Bot routes ───────────────────────────────────────────────────────

const tradingPortfolio = require('./trading/portfolio');
const tradingBot       = require('./trading/bot');
const { FICTIONAL_STOCKS: STOCKS } = require('./trading/fictional-stocks');
const { priceCache }   = require('./trading/market-data');

// Lazy-load market data module to avoid issues if Yahoo Finance is down at startup
let marketDataModule = null;
function getMarketData() {
  if (!marketDataModule) marketDataModule = require('./trading/market-data');
  return marketDataModule;
}

app.use(express.json());

// GET /api/trading/portfolio — full portfolio summary
app.get('/api/trading/portfolio', (_req, res) => {
  try {
    const state = tradingPortfolio.load();
    res.json(tradingPortfolio.getSummary(state));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trading/history — all daily snapshots
app.get('/api/trading/history', (_req, res) => {
  try {
    const state = tradingPortfolio.load();
    res.json({ snapshots: state.snapshots || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trading/stocks — fictional stock list with latest cached prices
app.get('/api/trading/stocks', (_req, res) => {
  try {
    const state = tradingPortfolio.load();
    const stocks = STOCKS.map(s => {
      const cached = priceCache.get(s.realTicker);
      const priceData = cached && Date.now() < cached.expiresAt ? cached.data : null;
      const position = state.positions[s.symbol] || null;
      return {
        symbol: s.symbol,
        name: s.name,
        sector: s.sector,
        price: priceData?.price || null,
        change: priceData?.change || null,
        changePercent: priceData?.changePercent || null,
        stale: priceData?.stale || false,
        held: position ? position.shares : 0,
      };
    });
    res.json({ stocks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trading/run — manually trigger a trading cycle
app.post('/api/trading/run', async (_req, res) => {
  try {
    const result = await tradingBot.runDailyTradingCycle({ force: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trading/status — bot status
app.get('/api/trading/status', (_req, res) => {
  try {
    const { getNextRunTime } = require('./trading/scheduler');
    const status = tradingBot.getStatus();
    res.json({
      ...status,
      nextRun: getNextRunTime().toISOString(),
    });
  } catch (err) {
    // scheduler may not be fully init'd yet
    res.json({ ...tradingBot.getStatus(), nextRun: null });
  }
});

// Start the scheduler
require('./trading/scheduler');
