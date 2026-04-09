import rateLimit from 'express-rate-limit';

/** General API rate limit: 120 requests per minute per IP */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Slow down.' },
});

/** Tighter limit for account endpoints (wallet data lookups) */
export const accountLimiter = rateLimit({
  windowMs: 60 * 1_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many account lookups. Please wait.' },
});
