'use strict';

const BASE = '';
let perfChart = null;
let refreshTimer = null;

// ── Helpers ─────────────────────────────────────────────────────────────────

async function apiFetch(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function fmt(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDollar(n) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const str = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-$' : '$') + str;
}

function signClass(n) {
  if (n > 0) return 'green';
  if (n < 0) return 'red';
  return '';
}

function signPrefix(n) {
  return n > 0 ? '+' : '';
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ── Summary cards ────────────────────────────────────────────────────────────

function renderCards(data) {
  // Portfolio value
  const valEl = document.getElementById('cardValue');
  valEl.textContent = fmtDollar(data.totalValue);
  valEl.className = 'card-value ' + signClass(data.pnl);

  // Cash
  document.getElementById('cardCash').textContent = fmtDollar(data.cash);
  document.getElementById('cardCashSub').textContent = fmtDollar(data.positionsValue) + ' invested';

  // P&L
  const pnlEl = document.getElementById('cardPnl');
  pnlEl.textContent = signPrefix(data.pnl) + fmtDollar(data.pnl);
  pnlEl.className = 'card-value ' + signClass(data.pnl);
  document.getElementById('cardPnlSub').textContent =
    signPrefix(data.pnlPercent) + fmt(data.pnlPercent) + '% return';

  // vs S&P 500
  const snap = data.latestSnapshot;
  const vsSpy = document.getElementById('cardVsSpy');
  const vsSpySub = document.getElementById('cardVsSpySub');
  if (snap && snap.spyIndexedValue) {
    const diff = data.totalValue - snap.spyIndexedValue;
    const diffPct = ((diff / snap.spyIndexedValue) * 100);
    vsSpy.textContent = signPrefix(diff) + fmtDollar(diff);
    vsSpy.className = 'card-value ' + signClass(diff);
    vsSpySub.textContent = signPrefix(diffPct) + fmt(diffPct) + '% vs index';
  } else {
    vsSpy.textContent = '—';
    vsSpySub.textContent = 'no benchmark data yet';
  }

  // AI summary
  if (data.marketSummary) {
    const el = document.getElementById('aiSummary');
    el.textContent = '🤖 ' + data.marketSummary;
    el.style.display = 'block';
  }
}

// ── Holdings table ───────────────────────────────────────────────────────────

function renderHoldings(positions) {
  const container = document.getElementById('holdingsBody');
  document.getElementById('holdingCount').textContent =
    positions.length + ' position' + (positions.length !== 1 ? 's' : '');

  if (positions.length === 0) {
    container.innerHTML = '<div class="empty">No open positions — all cash.</div>';
    return;
  }

  const rows = positions.map(p => `
    <tr>
      <td><strong>${p.symbol}</strong></td>
      <td class="num">${p.shares}</td>
      <td class="num">$${fmt(p.avgCost)}</td>
      <td class="num">$${fmt(p.currentPrice)}</td>
      <td class="num ${signClass(p.pnl)}">${signPrefix(p.pnl)}$${fmt(Math.abs(p.pnl))}</td>
      <td class="num ${signClass(p.pnlPercent)}">${signPrefix(p.pnlPercent)}${fmt(p.pnlPercent)}%</td>
    </tr>`).join('');

  container.innerHTML = `
    <table>
      <thead><tr>
        <th>Symbol</th><th class="num">Shares</th><th class="num">Avg Cost</th>
        <th class="num">Price</th><th class="num">P&amp;L</th><th class="num">P&amp;L %</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Market prices ─────────────────────────────────────────────────────────────

function renderMarket(stocks) {
  const container = document.getElementById('marketBody');

  const items = stocks.map(s => {
    const cls = s.changePercent >= 0 ? 'green' : 'red';
    const prefix = s.changePercent >= 0 ? '+' : '';
    return `
      <div class="market-item">
        <div class="market-name">${s.symbol} · ${s.name}</div>
        <div class="market-price ${cls}">$${fmt(s.price)}</div>
        <div class="market-change ${cls}">${prefix}${fmt(s.changePercent)}% · ${s.sector}</div>
      </div>`;
  }).join('');

  container.innerHTML = `<div class="market-grid">${items}</div>`;
}

// ── Trades log ────────────────────────────────────────────────────────────────

function renderTrades(trades) {
  const container = document.getElementById('tradesBody');
  document.getElementById('tradeCount').textContent =
    trades.length + ' trade' + (trades.length !== 1 ? 's' : '');

  if (trades.length === 0) {
    container.innerHTML = '<div class="empty">No trades yet — run first cycle to start.</div>';
    return;
  }

  const rows = trades.map(t => `
    <tr>
      <td>${formatDate(t.date)}</td>
      <td><strong>${t.symbol}</strong></td>
      <td><span class="badge ${t.action.toLowerCase()}">${t.action}</span></td>
      <td class="num">${t.shares}</td>
      <td class="num">$${fmt(t.price)}</td>
      <td style="color:var(--muted);font-size:0.78rem">${t.reasoning || '—'}</td>
    </tr>`).join('');

  container.innerHTML = `
    <table>
      <thead><tr>
        <th>Date</th><th>Symbol</th><th>Action</th>
        <th class="num">Shares</th><th class="num">Price</th><th>AI Reasoning</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Performance chart ─────────────────────────────────────────────────────────

function renderChart(snapshots) {
  const labels = snapshots.map(s => s.date);
  const portfolioVals = snapshots.map(s => s.portfolioValue);
  const spyVals = snapshots.map(s => s.spyIndexedValue);

  const ctx = document.getElementById('perfChart').getContext('2d');

  if (perfChart) perfChart.destroy();

  perfChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Portfolio',
          data: portfolioVals,
          borderColor: '#4ade80',
          backgroundColor: 'rgba(74,222,128,0.08)',
          borderWidth: 2,
          pointRadius: snapshots.length > 30 ? 0 : 3,
          tension: 0.3,
          fill: true,
        },
        {
          label: 'S&P 500 (indexed)',
          data: spyVals,
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96,165,250,0.06)',
          borderWidth: 2,
          pointRadius: snapshots.length > 30 ? 0 : 3,
          tension: 0.3,
          fill: true,
          borderDash: [5, 3],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e1e1e',
          borderColor: '#3a3a3a',
          borderWidth: 1,
          titleColor: '#e0e0e0',
          bodyColor: '#888',
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: $${ctx.parsed.y != null ? ctx.parsed.y.toLocaleString('en-US', { minimumFractionDigits: 2 }) : 'N/A'}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#666', maxTicksLimit: 8 },
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#666',
            callback: v => '$' + (v / 1000).toFixed(0) + 'k',
          },
        },
      },
    },
  });
}

// ── Status indicator ──────────────────────────────────────────────────────────

async function updateStatus() {
  try {
    const s = await apiFetch('/api/trading/status');
    const dot = document.getElementById('statusDot');
    const txt = document.getElementById('statusText');
    if (s.isRunning) {
      dot.className = 'status-dot running';
      txt.textContent = 'Running…';
    } else {
      dot.className = 'status-dot';
      txt.textContent = s.lastRunDate ? 'Last run: ' + formatDate(s.lastRunDate) : 'Idle';
    }
  } catch { /* ignore */ }
}

// ── Manual trigger ────────────────────────────────────────────────────────────

async function triggerRun() {
  const btn = document.getElementById('runBtn');
  btn.disabled = true;
  btn.textContent = 'Running…';

  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  dot.className = 'status-dot running';
  txt.textContent = 'Running…';

  try {
    const result = await apiFetch('/api/trading/run');
    // Small delay then refresh
    setTimeout(() => loadAll(), 2000);
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = 'Run Now';
    }, 3000);
  }
}

// Make triggerRun globally accessible (called from HTML onclick)
window.triggerRun = triggerRun;

// ── Full data load ────────────────────────────────────────────────────────────

async function loadAll() {
  try {
    const [portfolioData, historyData, stocksData] = await Promise.all([
      apiFetch('/api/trading/portfolio'),
      apiFetch('/api/trading/history'),
      apiFetch('/api/trading/stocks'),
    ]);

    renderCards(portfolioData);
    renderHoldings(portfolioData.positions || []);
    renderTrades(portfolioData.recentTrades || []);

    if (historyData.snapshots && historyData.snapshots.length > 0) {
      renderChart(historyData.snapshots);
    }

    if (stocksData.stocks) {
      renderMarket(stocksData.stocks);
    }

    await updateStatus();

    document.getElementById('lastRefresh').textContent =
      'Refreshed ' + new Date().toLocaleTimeString('en-GB');

  } catch (err) {
    console.error('[trading.js] Load error:', err);
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

loadAll();

// Auto-refresh every 5 minutes
refreshTimer = setInterval(loadAll, 5 * 60 * 1000);
