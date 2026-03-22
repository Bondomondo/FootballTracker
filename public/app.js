/* ── Local storage helpers ───────────────────────────────────────────────── */
const STORAGE_KEY = 'ft_favourites';

function loadFavourites() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch { return []; }
}

function saveFavourites(favs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favs));
}

/* ── State ────────────────────────────────────────────────────────────────── */
let favourites = loadFavourites(); // [{ team: {...}, league: {...} }]

/* ── Utility ──────────────────────────────────────────────────────────────── */
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatShortDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function getResultForTeam(fixture, teamId) {
  const { home, away } = fixture.teams;
  const { home: gh, away: ga } = fixture.goals;
  if (gh === null || ga === null) return null; // not played yet
  if (home.id === teamId) {
    if (gh > ga) return 'W';
    if (gh < ga) return 'L';
    return 'D';
  } else {
    if (ga > gh) return 'W';
    if (ga < gh) return 'L';
    return 'D';
  }
}

/* ── API calls ────────────────────────────────────────────────────────────── */
async function apiFetch(path) {
  const res = await fetch(path);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

/* ── Search ───────────────────────────────────────────────────────────────── */
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
let searchTimer = null;

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (q.length < 3) { searchResults.classList.add('hidden'); return; }
  searchTimer = setTimeout(() => doSearch(q), 400);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap')) {
    searchResults.classList.add('hidden');
  }
});

async function doSearch(q) {
  searchResults.innerHTML = '<div class="search-no-results">Searching…</div>';
  searchResults.classList.remove('hidden');
  try {
    const data = await apiFetch(`/api/teams/search?q=${encodeURIComponent(q)}`);
    const items = data.response || [];
    if (!items.length) {
      searchResults.innerHTML = '<div class="search-no-results">No teams found.</div>';
      return;
    }
    searchResults.innerHTML = items.slice(0, 10).map(item => {
      const already = favourites.some(f => f.team.id === item.team.id);
      return `
        <div class="search-item" data-id="${item.team.id}">
          <img src="${item.team.logo}" alt="" onerror="this.src='https://via.placeholder.com/32'"/>
          <div>
            <div class="search-item-name">${item.team.name}</div>
            <div class="search-item-league">${item.team.country || ''}</div>
          </div>
          <span class="search-item-add">${already ? '✓ Added' : '+ Add'}</span>
        </div>
      `;
    }).join('');

    searchResults.querySelectorAll('.search-item').forEach((el, idx) => {
      el.addEventListener('click', () => addFavourite(items[idx]));
    });
  } catch (err) {
    searchResults.innerHTML = `<div class="search-no-results">Error: ${err.message}</div>`;
  }
}

/* ── Favourites ───────────────────────────────────────────────────────────── */
function addFavourite(item) {
  if (favourites.some(f => f.team.id === item.team.id)) return;
  favourites.push({ team: item.team, league: item.league || {} });
  saveFavourites(favourites);
  searchResults.classList.add('hidden');
  searchInput.value = '';
  renderFavourites();
  // Load recent data for the new card
  loadCardData(item.team.id);
}

function removeFavourite(teamId) {
  favourites = favourites.filter(f => f.team.id !== teamId);
  saveFavourites(favourites);
  renderFavourites();
}

/* ── Cards ────────────────────────────────────────────────────────────────── */
const teamsGrid = document.getElementById('teamsGrid');
const emptyHint = document.getElementById('emptyHint');

// Cache recent fixtures per team to avoid re-fetching on re-render
const fixtureCache = {};

function renderFavourites() {
  emptyHint.style.display = favourites.length ? 'none' : 'block';
  teamsGrid.innerHTML = favourites.map(fav => buildCard(fav)).join('');

  // Wire up card buttons
  teamsGrid.querySelectorAll('.team-card').forEach(card => {
    const id = Number(card.dataset.teamId);
    card.addEventListener('click', (e) => {
      if (e.target.closest('.remove-btn')) return;
      openDetail(id);
    });
  });
  teamsGrid.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFavourite(Number(btn.dataset.teamId));
    });
  });

  // Fetch fresh fixture data for cards that don't have it yet
  favourites.forEach(fav => {
    if (!fixtureCache[fav.team.id]) {
      loadCardData(fav.team.id);
    } else {
      updateCardUI(fav.team.id, fixtureCache[fav.team.id]);
    }
  });
}

function buildCard(fav) {
  return `
    <div class="team-card" data-team-id="${fav.team.id}">
      <button class="remove-btn" data-team-id="${fav.team.id}" title="Remove">✕</button>
      <div class="team-card-header">
        <img class="team-card-logo" src="${fav.team.logo}" alt="${fav.team.name}" onerror="this.src='https://via.placeholder.com/48'"/>
        <div>
          <div class="team-card-name">${fav.team.name}</div>
          <div class="team-card-league">${fav.team.country || ''}</div>
        </div>
      </div>
      <div class="form-guide" id="form-${fav.team.id}">
        ${[1,2,3,4,5].map(() => `<div class="form-dot" style="background:var(--border)"></div>`).join('')}
      </div>
      <div id="stats-${fav.team.id}">
        <div class="stat-row"><span>Last 5</span><span>Loading…</span></div>
      </div>
    </div>
  `;
}

async function loadCardData(teamId) {
  try {
    const data = await apiFetch(`/api/fixtures/recent?teamId=${teamId}&last=5`);
    const fixtures = (data.response || []).sort(
      (a, b) => new Date(b.fixture.date) - new Date(a.fixture.date)
    );
    fixtureCache[teamId] = fixtures;
    updateCardUI(teamId, fixtures);
  } catch (err) {
    const statsEl = document.getElementById(`stats-${teamId}`);
    if (statsEl) statsEl.innerHTML = `<div class="stat-row"><span>Error loading</span></div>`;
  }
}

function updateCardUI(teamId, fixtures) {
  const formEl = document.getElementById(`form-${teamId}`);
  const statsEl = document.getElementById(`stats-${teamId}`);
  if (!formEl || !statsEl) return;

  const results = fixtures.map(f => getResultForTeam(f, teamId)).filter(Boolean);

  formEl.innerHTML = results.map(r => `<div class="form-dot ${r}">${r}</div>`).join('');

  const wins = results.filter(r => r === 'W').length;
  const draws = results.filter(r => r === 'D').length;
  const losses = results.filter(r => r === 'L').length;
  const goalsFor = fixtures.reduce((sum, f) => {
    const isHome = f.teams.home.id === teamId;
    return sum + (isHome ? (f.goals.home || 0) : (f.goals.away || 0));
  }, 0);
  const goalsAgainst = fixtures.reduce((sum, f) => {
    const isHome = f.teams.home.id === teamId;
    return sum + (isHome ? (f.goals.away || 0) : (f.goals.home || 0));
  }, 0);

  statsEl.innerHTML = `
    <div class="stat-row"><span>Last ${results.length} games</span><span>${wins}W ${draws}D ${losses}L</span></div>
    <div class="stat-row"><span>Goals</span><span>${goalsFor} scored / ${goalsAgainst} conceded</span></div>
  `;
}

/* ── Detail panel ─────────────────────────────────────────────────────────── */
const detailOverlay = document.getElementById('detailOverlay');
const detailContent = document.getElementById('detailContent');
const closeDetail  = document.getElementById('closeDetail');

closeDetail.addEventListener('click', closeDetailPanel);
detailOverlay.addEventListener('click', (e) => {
  if (e.target === detailOverlay) closeDetailPanel();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDetailPanel();
});

function closeDetailPanel() {
  detailOverlay.classList.add('hidden');
}

async function openDetail(teamId) {
  detailOverlay.classList.remove('hidden');
  detailContent.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div></div>';

  const fav = favourites.find(f => f.team.id === teamId);
  if (!fav) return;

  try {
    // Fetch recent + upcoming in parallel; standings/stats need leagueId
    const [recentData, upcomingData] = await Promise.all([
      apiFetch(`/api/fixtures/recent?teamId=${teamId}&last=10`),
      apiFetch(`/api/fixtures/upcoming?teamId=${teamId}&next=5`),
    ]);

    const recent   = (recentData.response || []).sort((a,b) => new Date(b.fixture.date) - new Date(a.fixture.date));
    const upcoming = upcomingData.response || [];

    // Try to get league/season from recent fixture
    let leagueId = null, season = null;
    if (recent.length) {
      leagueId = recent[0].league.id;
      season   = recent[0].league.season;
    }

    // Fetch standings + stats only if we have leagueId
    let standingsHtml = '<p class="error-msg">No league data found for recent fixtures.</p>';
    let statsHtml = standingsHtml;

    if (leagueId && season) {
      const [standingsData, statsData] = await Promise.all([
        apiFetch(`/api/standings?leagueId=${leagueId}&season=${season}`).catch(() => null),
        apiFetch(`/api/teams/statistics?teamId=${teamId}&leagueId=${leagueId}&season=${season}`).catch(() => null),
      ]);

      if (standingsData) standingsHtml = buildStandingsHtml(standingsData, teamId);
      if (statsData) statsHtml = buildStatsHtml(statsData);
    }

    detailContent.innerHTML = `
      <div class="detail-header">
        <img class="detail-logo" src="${fav.team.logo}" alt="${fav.team.name}" onerror="this.src='https://via.placeholder.com/64'"/>
        <div>
          <div class="detail-team-name">${fav.team.name}</div>
          <div class="detail-team-league">${fav.team.country || ''}</div>
        </div>
      </div>

      <div class="detail-tabs">
        <button class="tab-btn active" data-tab="recent">Recent Results</button>
        <button class="tab-btn" data-tab="upcoming">Upcoming</button>
        <button class="tab-btn" data-tab="standings">Standings</button>
        <button class="tab-btn" data-tab="stats">Statistics</button>
      </div>

      <div id="tab-recent" class="tab-pane active">${buildRecentHtml(recent, teamId)}</div>
      <div id="tab-upcoming" class="tab-pane">${buildUpcomingHtml(upcoming)}</div>
      <div id="tab-standings" class="tab-pane">${standingsHtml}</div>
      <div id="tab-stats" class="tab-pane">${statsHtml}</div>
    `;

    // Tab switching
    detailContent.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        detailContent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        detailContent.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      });
    });

  } catch (err) {
    detailContent.innerHTML = `<div class="error-msg">Failed to load data: ${err.message}</div>`;
  }
}

/* ── HTML builders ────────────────────────────────────────────────────────── */
function buildRecentHtml(fixtures, teamId) {
  if (!fixtures.length) return '<p style="color:var(--muted)">No recent fixtures found.</p>';
  return `<div class="fixture-list">` + fixtures.map(f => {
    const result = getResultForTeam(f, teamId);
    const badge  = result ? `<span class="result-badge ${result}">${result}</span>` : '';
    const score  = f.goals.home !== null
      ? `${f.goals.home} – ${f.goals.away}`
      : '–';
    return `
      <div class="fixture-item">
        <div class="fixture-team">
          <img src="${f.teams.home.logo}" alt="" onerror="this.src='https://via.placeholder.com/22'"/>
          ${f.teams.home.name}
          ${f.teams.home.id === teamId ? badge : ''}
        </div>
        <div class="fixture-score">
          ${score}
          <span class="fixture-date">${formatShortDate(f.fixture.date)}</span>
        </div>
        <div class="fixture-team away">
          ${f.teams.away.id === teamId ? badge : ''}
          ${f.teams.away.name}
          <img src="${f.teams.away.logo}" alt="" onerror="this.src='https://via.placeholder.com/22'"/>
        </div>
      </div>
    `;
  }).join('') + `</div>`;
}

function buildUpcomingHtml(fixtures) {
  if (!fixtures.length) return '<p style="color:var(--muted)">No upcoming fixtures found.</p>';
  return `<div class="fixture-list">` + fixtures.map(f => `
    <div class="fixture-item">
      <div class="fixture-team">
        <img src="${f.teams.home.logo}" alt="" onerror="this.src='https://via.placeholder.com/22'"/>
        ${f.teams.home.name}
      </div>
      <div class="fixture-score">
        vs
        <span class="fixture-date">${formatDate(f.fixture.date)}</span>
      </div>
      <div class="fixture-team away">
        ${f.teams.away.name}
        <img src="${f.teams.away.logo}" alt="" onerror="this.src='https://via.placeholder.com/22'"/>
      </div>
    </div>
  `).join('') + `</div>`;
}

function buildStandingsHtml(data, highlightTeamId) {
  const groups = data.response?.[0]?.league?.standings;
  if (!groups || !groups.length) return '<p style="color:var(--muted)">No standings data available.</p>';

  return groups.map(group => {
    const header = group[0]?.group || '';
    return `
      <h3 style="font-size:.85rem;color:var(--muted);margin-bottom:.75rem">${header}</h3>
      <table class="standings-table">
        <thead>
          <tr>
            <th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th>
          </tr>
        </thead>
        <tbody>
          ${group.map(row => `
            <tr class="${row.team.id === highlightTeamId ? 'highlighted' : ''}">
              <td>${row.rank}</td>
              <td>
                <div class="team-cell">
                  <img src="${row.team.logo}" alt="" onerror="this.src='https://via.placeholder.com/20'"/>
                  ${row.team.name}
                </div>
              </td>
              <td>${row.all.played}</td>
              <td>${row.all.win}</td>
              <td>${row.all.draw}</td>
              <td>${row.all.lose}</td>
              <td>${row.goalsDiff > 0 ? '+' : ''}${row.goalsDiff}</td>
              <td><strong>${row.points}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }).join('<br/>');
}

function buildStatsHtml(data) {
  const s = data.response;
  if (!s) return '<p style="color:var(--muted)">No statistics available.</p>';

  const played  = s.fixtures?.played?.total || 0;
  const wins    = s.fixtures?.wins?.total || 0;
  const draws   = s.fixtures?.draws?.total || 0;
  const losses  = s.fixtures?.loses?.total || 0;
  const gf      = s.goals?.for?.total?.total || 0;
  const ga      = s.goals?.against?.total?.total || 0;
  const gfAvg   = s.goals?.for?.average?.total || '0';
  const gaAvg   = s.goals?.against?.average?.total || '0';
  const cleanSheets = s.clean_sheet?.total || 0;
  const failedToScore = s.failed_to_score?.total || 0;

  const pct = (v, max) => max ? Math.round((v / max) * 100) : 0;

  return `
    <div class="stats-grid">
      <div class="stat-box"><div class="stat-box-value">${played}</div><div class="stat-box-label">Matches Played</div></div>
      <div class="stat-box"><div class="stat-box-value">${wins}</div><div class="stat-box-label">Wins</div></div>
      <div class="stat-box"><div class="stat-box-value">${gf}</div><div class="stat-box-label">Goals Scored</div></div>
      <div class="stat-box"><div class="stat-box-value">${ga}</div><div class="stat-box-label">Goals Conceded</div></div>
    </div>

    <div class="bar-stat">
      <div class="bar-label"><span>Wins</span><span>${wins} / ${played}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct(wins,played)}%"></div></div>
    </div>
    <div class="bar-stat">
      <div class="bar-label"><span>Draws</span><span>${draws} / ${played}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct(draws,played)}%;background:linear-gradient(90deg,#ca8a04,var(--draw))"></div></div>
    </div>
    <div class="bar-stat">
      <div class="bar-label"><span>Losses</span><span>${losses} / ${played}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct(losses,played)}%;background:linear-gradient(90deg,#dc2626,var(--loss))"></div></div>
    </div>

    <div style="margin-top:1.5rem">
      <div class="stat-row"><span>Avg goals scored per game</span><span>${gfAvg}</span></div>
      <div class="stat-row"><span>Avg goals conceded per game</span><span>${gaAvg}</span></div>
      <div class="stat-row"><span>Clean sheets</span><span>${cleanSheets}</span></div>
      <div class="stat-row"><span>Failed to score</span><span>${failedToScore}</span></div>
    </div>
  `;
}

/* ── Init ─────────────────────────────────────────────────────────────────── */
renderFavourites();
