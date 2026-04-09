import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { config } from '../lib/config';
import { cache } from '../lib/cache';
import { SentimentResult } from '../types/pacifica';

const router = Router();

/**
 * GET /api/v1/sentiment/:symbol
 *
 * Fetches Elfa AI social sentiment for a given symbol.
 * Returns a normalised SentimentResult regardless of the underlying
 * Elfa response shape, so the frontend has a stable contract.
 *
 * Cached for sentimentTtl (default 120 s) because Elfa data changes slowly
 * and hitting it on every price tick would exhaust the quota.
 *
 * Requires ELFA_AI_API_KEY – server will not start without it.
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

    const response = await axios.get(`${config.elfa.baseUrl}/mentions`, {
      params: { symbol },
      headers: { Authorization: `Bearer ${config.elfa.apiKey}` },
      timeout: 8_000,
    });

    // Normalise Elfa response into our SentimentResult shape.
    // Adjust field names here if Elfa's actual response differs.
    const raw = response.data;
    const mentionCount: number = raw.data?.mention_count ?? raw.mention_count ?? 0;
    const score: number = raw.data?.sentiment_score ?? raw.sentiment_score ?? 0;

    const result: SentimentResult = {
      symbol,
      mentionCount,
      sentimentScore: score,
      sentiment: score > 0.1 ? 'bullish' : score < -0.1 ? 'bearish' : 'neutral',
      fetchedAt: Date.now(),
    };

    cache.setLong(cacheKey, result);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
