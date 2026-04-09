# Knights Labs – Backend

Express + TypeScript API server for the Knights Labs funding rate analytics platform.

## Quick start

```bash
cd backend
npm install
cp .env.example .env   # then fill in your keys
npm run dev            # starts on http://localhost:3001
```

## REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service health + WS status |
| GET | `/api/v1/prices` | All markets enriched with stats (sort, order params) |
| GET | `/api/v1/prices/stats` | Cross-market mean/stdDev/median summary |
| GET | `/api/v1/prices/:symbol` | Single market enriched data |
| GET | `/api/v1/history/:symbol` | Funding history (limit, cursor, full params) |
| GET | `/api/v1/history/:symbol/zscore` | Historical z-score vs own window |
| GET | `/api/v1/markets` | All tradeable market specs |
| GET | `/api/v1/extremes` | Markets with \|z-score\| ≥ threshold |
| GET | `/api/v1/arbitrage` | Top funding-rate arb pairs |
| GET | `/api/v1/account/:address/positions` | Open positions for wallet |
| GET | `/api/v1/account/:address/funding` | Funding payment history for wallet |
| GET | `/api/v1/sentiment/:symbol` | Elfa AI social sentiment |

## WebSocket

Connect to `ws://localhost:3001/ws`.

```json
// Subscribe
{ "op": "subscribe", "channel": "prices" }
{ "op": "subscribe", "channel": "extremes" }

// Keep-alive
{ "op": "ping" }
```

The server maintains **one** upstream connection to Pacifica and fans updates to all connected clients.
Each `prices` message includes fully enriched `MarketWithStats` objects (annualizedRate, zScore, etc).
The `extremes` channel only fires when at least one market is flagged.

## Environment variables

See [`.env.example`](.env.example) – every variable is documented inline.

Key variables to set before running:

| Variable | Required | Description |
|----------|----------|-------------|
| `PACIFICA_API_KEY` | No | Higher WS rate limits |
| `ELFA_AI_API_KEY` | For sentiment | Hackathon sponsor key |
| `USE_TESTNET` | No | `true` to hit Pacifica testnet |
| `CORS_ALLOWED_ORIGINS` | Yes | Frontend origin(s), comma-separated |
