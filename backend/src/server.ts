import http from 'http';
import express from 'express';
import cors from 'cors';
import { config } from './lib/config';
import { cache } from './lib/cache';
import { getRelay, initRelay } from './websocket/pricesRelay';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter, accountLimiter } from './middleware/rateLimiter';

// ── Routes ────────────────────────────────────────────────────
import pricesRouter from './routes/prices';
import historyRouter from './routes/history';
import marketsRouter from './routes/markets';
import extremesRouter from './routes/extremes';
import arbitrageRouter from './routes/arbitrage';
import accountRouter from './routes/account';
import sentimentRouter from './routes/sentiment';

// ─────────────────────────────────────────────────────────────
//  Express app
// ─────────────────────────────────────────────────────────────

const app = express();

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (server-to-server, Postman, etc.)
    if (!origin) return cb(null, true);
    if (config.cors.allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} is not allowed`));
  },
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(apiLimiter);

// ── Health ─────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  const relay = getRelay();
  res.json({
    status: 'ok',
    service: 'knights-labs-backend',
    uptime: process.uptime(),
    pacificaWsConnected: relay?.connected ?? false,
    wsClients: relay?.clientCount ?? 0,
    cacheStats: cache.stats(),
    timestamp: Date.now(),
  });
});

// ── API Routes ─────────────────────────────────────────────────

app.use('/api/v1/prices', pricesRouter);
app.use('/api/v1/history', historyRouter);
app.use('/api/v1/markets', marketsRouter);
app.use('/api/v1/extremes', extremesRouter);
app.use('/api/v1/arbitrage', arbitrageRouter);
app.use('/api/v1/account', accountLimiter, accountRouter);
app.use('/api/v1/sentiment', sentimentRouter);

// ── 404 catch-all ─────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// ── Error handler (must be last) ─────────────────────────────

app.use(errorHandler);

// ─────────────────────────────────────────────────────────────
//  HTTP server + WebSocket relay
// ─────────────────────────────────────────────────────────────

const server = http.createServer(app);
initRelay(server);

server.listen(config.port, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║       Knights Labs Backend           ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  console.log(`  REST  →  http://localhost:${config.port}/api/v1`);
  console.log(`  WS    →  ws://localhost:${config.port}/ws`);
  console.log(`  Health → http://localhost:${config.port}/health`);
  console.log('');
  console.log(`  Env        : ${config.nodeEnv}`);
  console.log(`  Testnet    : ${config.pacifica.useTestnet}`);
  console.log(`  Pacifica   : ${config.pacifica.restUrl}`);
  console.log('');
});

export default app;
