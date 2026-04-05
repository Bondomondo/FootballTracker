'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { FICTIONAL_STOCKS } = require('./fictional-stocks');

let client = null;

function getClient() {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in environment');
    client = new Anthropic({ apiKey });
  }
  return client;
}

function fmt(n) {
  return typeof n === 'number' ? n.toFixed(2) : 'N/A';
}

function buildPrompt(portfolio, priceMap) {
  const totalValue = portfolio.cash + Object.values(portfolio.positions).reduce((s, p) => {
    return s + p.shares * (p.currentPrice || p.avgCost);
  }, 0);

  // Portfolio state section
  const positionLines = Object.entries(portfolio.positions).map(([sym, pos]) => {
    const val = pos.shares * (pos.currentPrice || pos.avgCost);
    const pct = (val / totalValue * 100).toFixed(1);
    return `  ${sym}: ${pos.shares} shares @ avg $${fmt(pos.avgCost)}, current $${fmt(pos.currentPrice)}, value $${fmt(val)} (${pct}% of portfolio)`;
  });
  const positionsText = positionLines.length > 0 ? positionLines.join('\n') : '  (none — all cash)';

  // Market data section (fictional symbols)
  const stockLines = FICTIONAL_STOCKS.map(stock => {
    const data = priceMap[stock.symbol];
    if (!data) return `  ${stock.symbol} | ${stock.name.padEnd(22)} | ${stock.sector.padEnd(12)} | N/A`;
    const staleFlag = data.stale ? ' [stale]' : '';
    return `  ${stock.symbol} | ${stock.name.padEnd(22)} | ${stock.sector.padEnd(12)} | $${fmt(data.price)} | ${data.changePercent >= 0 ? '+' : ''}${fmt(data.changePercent)}%${staleFlag}`;
  }).join('\n');

  // World market context
  const spyData = priceMap['SPY'];
  const qqqData = priceMap['QQQ'];
  const diaData = priceMap['DIA'];
  const marketLines = [
    spyData ? `  S&P 500 (SPY):  $${fmt(spyData.price)} | ${spyData.changePercent >= 0 ? '+' : ''}${fmt(spyData.changePercent)}%` : '  S&P 500 (SPY): N/A',
    qqqData ? `  NASDAQ (QQQ):   $${fmt(qqqData.price)} | ${qqqData.changePercent >= 0 ? '+' : ''}${fmt(qqqData.changePercent)}%` : '  NASDAQ (QQQ):  N/A',
    diaData ? `  Dow Jones (DIA): $${fmt(diaData.price)} | ${diaData.changePercent >= 0 ? '+' : ''}${fmt(diaData.changePercent)}%` : '  Dow Jones (DIA): N/A',
  ].join('\n');

  const today = new Date().toISOString().slice(0, 10);

  return `You are an AI investment portfolio manager for a simulated trading fund.

DATE: ${today}

=== PORTFOLIO STATE ===
Cash available:      $${fmt(portfolio.cash)}
Total portfolio value: $${fmt(totalValue)}
Starting capital:    $100,000.00
Overall P&L:         $${fmt(totalValue - 100000)} (${(((totalValue - 100000) / 100000) * 100).toFixed(2)}%)

Current positions:
${positionsText}

=== AVAILABLE STOCKS (18 tradeable) ===
Symbol | Company                | Sector       | Price   | Change%
${stockLines}

=== WORLD MARKET CONTEXT ===
${marketLines}

=== TRADING RULES ===
- You may BUY or SELL any of the 18 available stocks listed above
- HOLD means omitting a stock from the decisions array
- Maximum single position size: 25% of total portfolio value
- Minimum cash reserve to maintain: $5,000
- Shares must be whole numbers (integers), minimum 1
- For SELL: shares cannot exceed your current holdings for that symbol
- You may make 0–10 trades total per cycle; do not overtrade

=== RESPONSE FORMAT ===
Return ONLY a valid JSON object with no additional text, markdown, or explanation:
{
  "decisions": [
    { "symbol": "XXXX", "action": "BUY", "shares": 10, "reasoning": "one sentence" },
    { "symbol": "YYYY", "action": "SELL", "shares": 5, "reasoning": "one sentence" }
  ],
  "marketSummary": "One to two sentences summarising today's market conditions and your overall strategy."
}

If no trades are warranted, return: { "decisions": [], "marketSummary": "..." }`;
}

async function getTradeDecisions(portfolio, priceMap) {
  const anthropic = getClient();
  const prompt = buildPrompt(portfolio, priceMap);

  console.log('[ai-engine] Requesting trading decisions from Claude...');

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawText = message.content[0]?.text || '';
  console.log('[ai-engine] Claude raw response:', rawText.slice(0, 500));

  // Extract JSON from response (Claude sometimes wraps it in ```json blocks)
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in Claude response');

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Failed to parse Claude JSON: ${e.message}\nRaw: ${rawText}`);
  }

  if (!Array.isArray(parsed.decisions)) {
    throw new Error('Claude response missing decisions array');
  }

  // Validate and sanitise each decision
  const validSymbols = new Set(FICTIONAL_STOCKS.map(s => s.symbol));
  const validated = parsed.decisions
    .filter(d => {
      if (!validSymbols.has(d.symbol)) {
        console.warn(`[ai-engine] Ignoring unknown symbol: ${d.symbol}`);
        return false;
      }
      if (!['BUY', 'SELL'].includes(d.action)) {
        console.warn(`[ai-engine] Ignoring invalid action: ${d.action}`);
        return false;
      }
      const shares = Math.floor(Number(d.shares));
      if (!shares || shares < 1) {
        console.warn(`[ai-engine] Ignoring zero/invalid shares for ${d.symbol}`);
        return false;
      }
      d.shares = shares;
      return true;
    });

  return {
    decisions: validated,
    marketSummary: parsed.marketSummary || '',
  };
}

module.exports = { getTradeDecisions };
