import { Router, Request, Response } from 'express';
import { config } from '../lib/config';

const router = Router();

/**
 * GET /api/v1/builder/config
 *
 * Exposes the Knights Labs builder code and fee rate so the frontend
 * can attach the builder code to orders placed by users on Pacifica.
 * This is how trades get attributed to Knights Labs and fee revenue accrues.
 *
 * No caching – values come directly from in-process config.
 * No sensitive data is exposed.
 */
router.get('/config', (_req: Request, res: Response) => {
  const feeRateNum = parseFloat(config.pacifica.builder.feeRate);
  res.json({
    success: true,
    data: {
      builderCode: config.pacifica.builder.code,
      feeRate: config.pacifica.builder.feeRate,
      feeRatePercent: `${(feeRateNum * 100).toFixed(2)}%`,
    },
  });
});

export default router;
