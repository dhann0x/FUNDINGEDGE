import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

const useTestnet = optional('USE_TESTNET', 'false') === 'true';

export const config = {
  port: parseInt(optional('PORT', '3001'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),

  // ── Pacifica ─────────────────────────────────────────────────
  pacifica: {
    restUrl: useTestnet
      ? optional('PACIFICA_TESTNET_REST_URL', 'https://test-api.pacifica.fi/api/v1')
      : optional('PACIFICA_REST_URL', 'https://api.pacifica.fi/api/v1'),
    wsUrl: useTestnet
      ? optional('PACIFICA_TESTNET_WS_URL', 'wss://test-ws.pacifica.fi')
      : optional('PACIFICA_WS_URL', 'wss://ws.pacifica.fi'),
    /** API Config Key – self-generated from Pacifica dashboard for higher WS rate limits. Optional. */
    apiKey: optional('PACIFICA_API_KEY', ''),
    /** Builder code (Code Name Preference) assigned by the Pacifica builder program. */
    builder: {
      code: required('PACIFICA_BUILDER_CODE'),
      feeRate: required('PACIFICA_BUILDER_FEE_RATE'),
    },
    useTestnet,
  },

  // ── Elfa AI ───────────────────────────────────────────────────
  elfa: {
    apiKey: required('ELFA_AI_API_KEY'),
    baseUrl: optional('ELFA_AI_BASE_URL', 'https://api.elfa.ai/v1'),
  },

  // ── CORS / Frontend ───────────────────────────────────────────
  cors: {
    allowedOrigins: optional('CORS_ALLOWED_ORIGINS', 'http://localhost:3000').split(','),
  },

  // ── Cache TTLs (seconds) ──────────────────────────────────────
  cache: {
    pricesTtl: parseInt(optional('CACHE_PRICES_TTL_S', '5'), 10),
    marketInfoTtl: parseInt(optional('CACHE_MARKET_INFO_TTL_S', '60'), 10),
    historyTtl: parseInt(optional('CACHE_HISTORY_TTL_S', '30'), 10),
    sentimentTtl: parseInt(optional('CACHE_SENTIMENT_TTL_S', '120'), 10),
  },

  // ── Statistics ────────────────────────────────────────────────
  stats: {
    /** |zScore| above this threshold flags a market as extreme */
    extremeZScoreThreshold: parseFloat(optional('EXTREME_Z_SCORE_THRESHOLD', '2')),
    /** Minimum hourly rate spread to surface an arbitrage pair */
    arbitrageMinSpread: parseFloat(optional('ARBITRAGE_MIN_SPREAD', '0.0001')),
    /** Maximum number of arbitrage pairs to return */
    arbitrageMaxPairs: parseInt(optional('ARBITRAGE_MAX_PAIRS', '20'), 10),
    /** Number of most-recent history records used to compute per-market z-score */
    historyWindowSize: parseInt(optional('STATS_HISTORY_WINDOW', '168'), 10), // 7 days hourly
  },
} as const;
