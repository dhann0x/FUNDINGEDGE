import { Router, Request, Response, NextFunction } from 'express';
import { fetchMarketInfo } from '../lib/pacificaClient';
import { cache } from '../lib/cache';

const router = Router();
const CACHE_KEY = 'markets:info';

/**
 * GET /api/v1/markets
 *
 * Returns all tradeable market specifications from Pacifica /info.
 * Cached for 60 s – this data changes rarely.
 */
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    let info = cache.getLong<unknown[]>(CACHE_KEY);
    if (!info) {
      info = await fetchMarketInfo();
      cache.setLong(CACHE_KEY, info);
    }
    res.json({ success: true, data: info, count: info.length });
  } catch (err) {
    next(err);
  }
});

export default router;
