import axios from 'axios';
import { config } from './config';
import { SentimentResult, SentimentSnapshot, SentimentTrend } from '../types/pacifica';

// ─────────────────────────────────────────────────────────────
//  Elfa AI HTTP client
// ─────────────────────────────────────────────────────────────

const http = axios.create({
  baseURL: config.elfa.baseUrl,
  timeout: 8_000,
  headers: { Authorization: `Bearer ${config.elfa.apiKey}` },
});

// ─────────────────────────────────────────────────────────────
//  Raw fetch helpers
// ─────────────────────────────────────────────────────────────

interface ElfaRaw {
  data?: { mention_count?: number; sentiment_score?: number };
  mention_count?: number;
  sentiment_score?: number;
}

function parseElfaResponse(raw: ElfaRaw, symbol: string, window: string): SentimentSnapshot {
  const mentionCount: number = raw.data?.mention_count ?? raw.mention_count ?? 0;
  const score: number = raw.data?.sentiment_score ?? raw.sentiment_score ?? 0;
  return { sentimentScore: score, mentionCount, window, fetchedAt: Date.now() };
}

/**
 * Fetch sentiment for a specific time window.
 * Passes `from` / `to` as Unix seconds — Elfa will ignore them if unsupported,
 * returning current/default data, which we detect and handle gracefully.
 */
async function fetchWindow(
  symbol: string,
  fromMs: number,
  toMs: number,
  windowLabel: string,
): Promise<SentimentSnapshot> {
  const res = await http.get<ElfaRaw>('/mentions', {
    params: {
      symbol,
      from: Math.floor(fromMs / 1_000),
      to: Math.floor(toMs / 1_000),
    },
  });
  return parseElfaResponse(res.data, symbol, windowLabel);
}

// ─────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────

/**
 * Fetch the current sentiment snapshot for a symbol.
 * Used by the existing GET /api/v1/sentiment/:symbol endpoint.
 */
export async function fetchCurrentSentiment(symbol: string): Promise<SentimentResult> {
  const res = await http.get<ElfaRaw>('/mentions', { params: { symbol } });
  const snap = parseElfaResponse(res.data, symbol, 'current');
  return {
    symbol,
    mentionCount: snap.mentionCount,
    sentimentScore: snap.sentimentScore,
    sentiment: snap.sentimentScore > 0.1 ? 'bullish' : snap.sentimentScore < -0.1 ? 'bearish' : 'neutral',
    fetchedAt: snap.fetchedAt,
  };
}

/**
 * Fetch sentiment trend for a symbol by comparing two time windows:
 *   recent   – last 24 hours
 *   baseline – previous 6 days (days 2–7)
 *
 * Computes scoreDelta, trendStrength (-1 to 1), and trend direction.
 *
 * If Elfa does not support time-windowed queries (both windows return the
 * same score), trendStrength will be 0 and trend will be 'flat'. This is
 * handled cleanly downstream — the divergence classifier treats flat
 * sentiment as neutral.
 */
export async function fetchSentimentTrend(symbol: string): Promise<SentimentTrend> {
  const now = Date.now();
  const MS_24H = 24 * 60 * 60 * 1_000;
  const MS_7D = 7 * MS_24H;

  // Fetch both windows in parallel
  const [recent, baseline] = await Promise.all([
    fetchWindow(symbol, now - MS_24H, now, '24h'),
    fetchWindow(symbol, now - MS_7D, now - MS_24H, '7d_baseline'),
  ]);

  const scoreDelta = recent.sentimentScore - baseline.sentimentScore;

  // Normalise delta to -1..1 using a ±1.0 practical score range
  // (Elfa scores typically range -1 to 1 already)
  const trendStrength = Math.max(-1, Math.min(1, scoreDelta));

  let trend: SentimentTrend['trend'];
  if (Math.abs(trendStrength) < 0.05) {
    trend = 'flat';
  } else {
    trend = trendStrength > 0 ? 'rising' : 'falling';
  }

  return {
    symbol,
    recent,
    baseline,
    scoreDelta: parseFloat(scoreDelta.toFixed(4)),
    trendStrength: parseFloat(trendStrength.toFixed(4)),
    trend,
    fetchedAt: Date.now(),
  };
}
