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
  LIVE: 5 * 60 * 1000,                // 5min – live scores
};

async function apiFetch(endpoint, params = {}) {
  if (!API_KEY) {
    throw new Error('API_FOOTBALL_KEY is not set. Add it to your .env file.');
  }

  const url = new URL(`${API_BASE}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const cacheKey = url.toString();
  const ttl = endpoint === 'fixtures' && params.live
    ? TTL.LIVE
    : endpoint === 'teams'
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

// Last N fixtures for a team
app.get('/api/fixtures/recent', async (req, res) => {
  const { teamId, last = 5 } = req.query;
  if (!teamId) return res.status(400).json({ error: 'teamId required' });
  try {
    const data = await apiFetch('fixtures', { team: teamId, last });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Next N fixtures for a team
app.get('/api/fixtures/upcoming', async (req, res) => {
  const { teamId, next = 5 } = req.query;
  if (!teamId) return res.status(400).json({ error: 'teamId required' });
  try {
    const data = await apiFetch('fixtures', { team: teamId, next });
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
