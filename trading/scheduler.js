'use strict';

const cron = require('node-cron');
const { runDailyTradingCycle } = require('./bot');

// Schedule: 4:00 PM Eastern Time
// EDT (UTC-4): 20:00 UTC  |  EST (UTC-5): 21:00 UTC
// We schedule at 21:00 UTC to be safe — this covers the end of US market hours
cron.schedule('0 21 * * 1-5', async () => {
  console.log('[scheduler] Triggering scheduled daily trading cycle...');
  await runDailyTradingCycle();
}, {
  timezone: 'UTC',
});

// Calculate and log next run time
function getNextRunTime() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(21, 0, 0, 0);

  // If already past 21:00 UTC today, move to next weekday
  if (now >= next) next.setDate(next.getDate() + 1);

  // Skip weekend
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

const nextRun = getNextRunTime();
console.log(`[scheduler] Daily trading bot active — next cycle: ${nextRun.toUTCString()} (weekdays at 21:00 UTC / ~4pm ET)`);

module.exports = { getNextRunTime };
