import { Router, Request, Response, NextFunction } from 'express';
import { fetchCurrentSentiment, fetchSentimentTrend } from '../lib/elfaClient';
import { cache } from '../lib/cache';
import { SentimentResult, SentimentTrend } from '../types/pacifica';

const router = Router();

/**
 * GET /api/v1/sentiment/:symbol
 *
 * Current sentiment snapshot for a symbol.
 * Cached for sentimentTtl (default 120 s).
 */
router.get('/:symbol', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const cacheKey = `sentiment:${symbol}`;

    const cached = cache.getLong<SentimentResult>(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached });
      return;
    }

    const result = await fetchCurrentSentiment(symbol);
    cache.setLong(cacheKey, result);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/sentiment/:symbol/trend
 *
 * Sentiment trend for a symbol derived from comparing two time windows:
 *   - recent   (last 24 hours)
 *   - baseline (previous 6 days)
 *
 * Returns scoreDelta, trendStrength (-1 to 1), and trend direction
 * ("rising" | "falling" | "flat").
 *
 * Cached for sentimentTtl. Used by the divergence endpoint.
 */
router.get('/:symbol/trend', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const cacheKey = `sentiment:trend:${symbol}`;

    const cached = cache.getLong<SentimentTrend>(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached });
      return;
    }

    const trend = await fetchSentimentTrend(symbol);
    cache.setLong(cacheKey, trend);
    res.json({ success: true, data: trend });
  } catch (err) {
    next(err);
  }
});

export default router;
