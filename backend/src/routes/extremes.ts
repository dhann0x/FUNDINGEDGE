import { Router, Request, Response, NextFunction } from 'express';
import { fetchAllPrices } from '../lib/pacificaClient';
import { enrichMarkets } from '../lib/statistics';
import { cache } from '../lib/cache';
import { MarketWithStats } from '../types/pacifica';
import { config } from '../lib/config';

const router = Router();
const CACHE_KEY_PRICES = 'prices:all';

/**
 * GET /api/v1/extremes
 *
 * Returns only the markets currently flagged as statistically extreme
 * (|z-score| ≥ threshold, default 2.0).
 *
 * Query params:
 *   threshold – override the z-score threshold (default from config)
 *   direction – "long_favored" | "short_favored" | "both" (default: "both")
 *
 * Each item includes:
 *   zScore, isExtreme, extremeDirection, annualizedRate, fundingRateNum, etc.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const threshold = parseFloat(
      (req.query.threshold as string) ?? String(config.stats.extremeZScoreThreshold),
    );
    const direction = (req.query.direction as string) ?? 'both';

    let markets = cache.getPrices<MarketWithStats[]>(CACHE_KEY_PRICES);
    if (!markets) {
      const raw = await fetchAllPrices();
      markets = enrichMarkets(raw, threshold);
      cache.setPrices(CACHE_KEY_PRICES, markets);
    }

    let extremes = markets.filter(
      (m) => Math.abs(m.zScore) >= threshold,
    );

    if (direction !== 'both') {
      extremes = extremes.filter((m) => m.extremeDirection === direction);
    }

    // Sort by absolute z-score descending – strongest signal first
    extremes.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));

    res.json({
      success: true,
      data: extremes,
      count: extremes.length,
      threshold,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
