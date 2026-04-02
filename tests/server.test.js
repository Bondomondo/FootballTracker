process.env.API_FOOTBALL_KEY = 'test_key';

const request = require('supertest');

// Mock node-fetch before requiring the app so all fetch calls are intercepted
jest.mock('node-fetch', () => jest.fn());
const fetch = require('node-fetch');

const mockResponse = (body) => ({
  ok: true,
  json: async () => body,
});

beforeEach(() => {
  jest.resetModules();
  fetch.mockReset();
});

function loadApp() {
  jest.resetModules();
  const fetch = require('node-fetch');
  fetch.mockResolvedValue(mockResponse({ response: [] }));
  return require('../server');
}

describe('GET /api/teams/search', () => {
  test('returns empty array for query shorter than 3 chars', async () => {
    const app = loadApp();
    const res = await request(app).get('/api/teams/search?q=ab');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ response: [] });
  });

  test('returns 200 with data for valid query', async () => {
    const app = loadApp();
    const fetchMock = require('node-fetch');
    fetchMock.mockResolvedValue(mockResponse({ response: [{ team: { id: 42, name: 'Arsenal' } }] }));

    const res = await request(app).get('/api/teams/search?q=Arsenal');
    expect(res.status).toBe(200);
    expect(res.body.response).toHaveLength(1);
    expect(res.body.response[0].team.name).toBe('Arsenal');
  });

  test('returns empty array when q is missing', async () => {
    const app = loadApp();
    const res = await request(app).get('/api/teams/search');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ response: [] });
  });
});

describe('GET /api/fixtures/recent', () => {
  test('returns 400 when teamId is missing', async () => {
    const app = loadApp();
    const res = await request(app).get('/api/fixtures/recent');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/teamId/);
  });

  test('returns 200 with fixture data for valid teamId', async () => {
    const app = loadApp();
    const fetchMock = require('node-fetch');
    const fixtureData = { response: [{ fixture: { id: 1 } }] };
    fetchMock.mockResolvedValue(mockResponse(fixtureData));

    const res = await request(app).get('/api/fixtures/recent?teamId=42');
    expect(res.status).toBe(200);
    expect(res.body.response).toHaveLength(1);
  });
});

describe('GET /api/standings', () => {
  test('returns 400 when leagueId is missing', async () => {
    const app = loadApp();
    const res = await request(app).get('/api/standings?season=2024');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/leagueId/);
  });

  test('returns 400 when season is missing', async () => {
    const app = loadApp();
    const res = await request(app).get('/api/standings?leagueId=39');
    expect(res.status).toBe(400);
  });

  test('returns 200 with standings data', async () => {
    const app = loadApp();
    const fetchMock = require('node-fetch');
    fetchMock.mockResolvedValue(mockResponse({ response: [{ league: { standings: [] } }] }));

    const res = await request(app).get('/api/standings?leagueId=39&season=2024');
    expect(res.status).toBe(200);
    expect(res.body.response).toHaveLength(1);
  });
});

describe('GET /api/teams/statistics', () => {
  test('returns 400 when params are missing', async () => {
    const app = loadApp();
    const res = await request(app).get('/api/teams/statistics?teamId=42');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/leagueId/);
  });

  test('returns 200 with statistics data', async () => {
    const app = loadApp();
    const fetchMock = require('node-fetch');
    fetchMock.mockResolvedValue(mockResponse({ response: { fixtures: {} } }));

    const res = await request(app).get('/api/teams/statistics?teamId=42&leagueId=39&season=2024');
    expect(res.status).toBe(200);
    expect(res.body.response).toBeDefined();
  });
});

describe('GET /api/cache/stats', () => {
  test('returns cache entry count', async () => {
    const app = loadApp();
    const res = await request(app).get('/api/cache/stats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('entries');
  });
});

describe('Caching', () => {
  test('second identical request is served from cache (fetch called once)', async () => {
    jest.resetModules();
    const fetchMock = require('node-fetch');
    fetchMock.mockResolvedValue(mockResponse({ response: [{ team: { id: 42 } }] }));
    const app = require('../server');

    await request(app).get('/api/teams/search?q=Arsenal');
    await request(app).get('/api/teams/search?q=Arsenal');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
