import { Router, Request, Response, NextFunction } from 'express';
import { fetchAllPrices } from '../lib/pacificaClient';
import { enrichMarkets, classifyDivergence } from '../lib/statistics';
import { fetchSentimentTrend } from '../lib/elfaClient';
import { cache } from '../lib/cache';
import { MarketWithStats, FundingSentimentDivergence, SentimentTrend } from '../types/pacifica';
import { config } from '../lib/config';

const router = Router();
const CACHE_KEY_PRICES = 'prices:all';

/**
 * GET /api/v1/divergence
 *
 * For every market currently flagged as an extreme (|z-score| ≥ threshold),
 * fetches the Elfa AI sentiment trend and classifies the divergence between
 * social sentiment and funding rate positioning.
 *
 * This surfaces the highest-conviction setups — e.g. a market where
 * shorts are paying an extreme rate (negative funding) while social
 * sentiment is rising (SHORT_SQUEEZE_SETUP).
 *
 * Query params:
 *   threshold – z-score threshold for filtering extreme markets (default from config)
 *   signal    – filter by specific signal type (e.g. "SHORT_SQUEEZE_SETUP")
 *
 * Sentiment trends are fetched in parallel for all extreme markets.
 * Individual sentiment failures do not abort the entire response —
 * that market is omitted from results instead.
 *
 * Cached for sentimentTtl (120 s by default) since sentiment data
 * changes slowly.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const threshold = parseFloat(
      (req.query.threshold as string) ?? String(config.stats.extremeZScoreThreshold),
    );
    const signalFilter = req.query.signal as string | undefined;

    const cacheKey = `divergence:${threshold}:${signalFilter ?? 'all'}`;
    const cached = cache.getLong<FundingSentimentDivergence[]>(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached, count: cached.length });
      return;
    }

    // ── Step 1: Get extreme markets ───────────────────────────
    let markets = cache.getPrices<MarketWithStats[]>(CACHE_KEY_PRICES);
    if (!markets) {
      const raw = await fetchAllPrices();
      markets = enrichMarkets(raw, threshold);
      cache.setPrices(CACHE_KEY_PRICES, markets);
    }

    const extremes = markets.filter((m) => Math.abs(m.zScore) >= threshold);

    if (extremes.length === 0) {
      res.json({ success: true, data: [], count: 0 });
      return;
    }

    // ── Step 2: Fetch sentiment trend for each extreme ────────
    const trendResults = await Promise.allSettled(
      extremes.map(async (market) => {
        const trendCacheKey = `sentiment:trend:${market.symbol}`;
        let trend = cache.getLong<SentimentTrend>(trendCacheKey);
        if (!trend) {
          trend = await fetchSentimentTrend(market.symbol);
          cache.setLong(trendCacheKey, trend);
        }
        return { market, trend };
      }),
    );

    // ── Step 3: Classify divergence ───────────────────────────
    const divergences: FundingSentimentDivergence[] = [];

    for (const result of trendResults) {
      if (result.status === 'rejected') continue; // skip if Elfa fetch failed
      const { market, trend } = result.value;
      const d = classifyDivergence(market, trend, threshold);
      if (!signalFilter || d.signal === signalFilter) {
        divergences.push(d);
      }
    }

    // Sort by signal strength descending — strongest setups first
    divergences.sort((a, b) => b.signalStrength - a.signalStrength);

    cache.setLong(cacheKey, divergences);
    res.json({ success: true, data: divergences, count: divergences.length });
  } catch (err) {
    next(err);
  }
});

export default router;
