'use strict';

// Maps fictional company names/tickers to real underlying tickers used solely for price data.
// Users only ever see the fictional symbols and names.
const FICTIONAL_STOCKS = [
  { symbol: 'NXTC', name: 'NexaTech Corp',       realTicker: 'AAPL',  sector: 'Technology'  },
  { symbol: 'QNTD', name: 'Quantum Dynamics',     realTicker: 'MSFT',  sector: 'Technology'  },
  { symbol: 'SLRV', name: 'SolarVentures Inc',    realTicker: 'TSLA',  sector: 'Energy'      },
  { symbol: 'AURX', name: 'Aurora Systems',        realTicker: 'GOOGL', sector: 'Technology'  },
  { symbol: 'NVXA', name: 'NovAI Semiconductor',  realTicker: 'NVDA',  sector: 'Technology'  },
  { symbol: 'MRCL', name: 'Mercantile Cloud',     realTicker: 'AMZN',  sector: 'Consumer'    },
  { symbol: 'BRIX', name: 'Brixstone Financial',  realTicker: 'JPM',   sector: 'Finance'     },
  { symbol: 'HLTH', name: 'HelixHealth Group',    realTicker: 'UNH',   sector: 'Healthcare'  },
  { symbol: 'ENRG', name: 'EnergyCrest Corp',     realTicker: 'XOM',   sector: 'Energy'      },
  { symbol: 'RXPX', name: 'RxPharma Labs',        realTicker: 'JNJ',   sector: 'Healthcare'  },
  { symbol: 'VCTR', name: 'VectorRetail Inc',     realTicker: 'WMT',   sector: 'Consumer'    },
  { symbol: 'FSTR', name: 'FastStream Media',     realTicker: 'NFLX',  sector: 'Consumer'    },
  { symbol: 'AERX', name: 'AeroX Ventures',       realTicker: 'BA',    sector: 'Industrial'  },
  { symbol: 'CYPH', name: 'CypherSec Ltd',        realTicker: 'PANW',  sector: 'Technology'  },
  { symbol: 'MNRL', name: 'Mineral Dynamics',     realTicker: 'FCX',   sector: 'Materials'   },
  { symbol: 'BNKR', name: 'Bankr Corp',           realTicker: 'GS',    sector: 'Finance'     },
  { symbol: 'GRWX', name: 'GrowX AgTech',         realTicker: 'DE',    sector: 'Industrial'  },
  { symbol: 'WVLT', name: 'Wavelet Comms',        realTicker: 'VZ',    sector: 'Telecom'     },
];

// World index tickers fetched for AI market context (never shown as tradeable)
const WORLD_INDICES = [
  { name: 'S&P 500',  ticker: 'SPY'   },  // used as benchmark
  { name: 'NASDAQ',   ticker: 'QQQ'   },
  { name: 'Dow Jones', ticker: 'DIA'  },
];

const symbolMap = Object.fromEntries(FICTIONAL_STOCKS.map(s => [s.symbol, s]));
const realTickerMap = Object.fromEntries(FICTIONAL_STOCKS.map(s => [s.realTicker, s]));

function getBySymbol(sym) {
  return symbolMap[sym] || null;
}

function getByRealTicker(ticker) {
  return realTickerMap[ticker] || null;
}

module.exports = { FICTIONAL_STOCKS, WORLD_INDICES, getBySymbol, getByRealTicker };
