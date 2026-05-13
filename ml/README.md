# H.E.X.A. ML Sidecar

Python service that trains XGBoost models on `pick_features` and exposes
prediction endpoints to the Node API. This is the **Sprint 2** deliverable —
real ML replacing the deterministic shadow validator.

The Node Oracle remains untouched. The sidecar runs alongside the API on
Railway, called via HTTP through `mlModelClient.js` (added in Sprint 3).

## Architecture

```
┌────────────────────┐   HTTP (internal)    ┌──────────────────────┐
│   Node API         │ ───────────────────► │  Python ML Sidecar   │
│   (server/)        │ ◄─────────────────── │  (ml/)               │
│   Railway service  │                      │  Railway service     │
└─────────┬──────────┘                      └──────────┬───────────┘
          │                                            │
          │            Postgres (DATABASE_URL)         │
          └────────────────┬───────────────────────────┘
                           ▼
                    ┌─────────────┐
                    │ pick_features│
                    └─────────────┘
```

Both services read the same Postgres database. The sidecar reads
`pick_features` for training; the Node API writes new rows there from
the Oracle as picks are created.

## Stack

- **Python 3.11+** with `pyproject.toml` (PEP 621) and a pinned `requirements.txt`
- **FastAPI** + `uvicorn` for the HTTP server
- **XGBoost 2.1** classifier per market with **Platt scaling** for probability calibration
- **scikit-learn** for the logistic-regression-based calibrator and metrics
- **pandas / SQLAlchemy** for data loading from Postgres or CSV
- **joblib** for model serialization

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET  | `/health` | Liveness + which markets have artifacts loaded |
| POST | `/predict/moneyline` | P(home wins) |
| POST | `/predict/overunder` | P(OVER hits — the `line` field is required) |
| POST | `/predict/runline` | P(home covers -1.5) |
| POST | `/predict/batch` | Score up to 50 mixed-market items in one call |
| GET  | `/calibration` | Reliability stats from the latest training manifest |
| POST | `/retrain` | Run a training pass and reload models from disk |

All endpoints except `/health` require `Authorization: Bearer $HEXA_ML_INTERNAL_TOKEN`.

### Example: single prediction

```bash
curl -X POST "$HEXA_ML_API_URL/predict/moneyline" \
  -H "Authorization: Bearer $HEXA_ML_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "home_pitcher_xwoba": 0.295,
    "away_pitcher_xwoba": 0.338,
    "home_team_ops": 0.745,
    "away_team_ops": 0.712,
    "odds_ml_home": -135,
    "odds_ml_away": +115,
    "park_factor_overall": 102,
    "temperature": 72,
    "wind_speed": 8
  }'
```

Returns:

```json
{
  "market": "moneyline",
  "probability": 0.6234,
  "confidence": 24.68,
  "top_features": [
    ["pitcher_xwoba_diff", 0.142],
    ["implied_prob_home", 0.118],
    ["home_pitcher_era", 0.094]
  ],
  "model_version": "2026-05-13T06:00:00+00:00"
}
```

## Training pipeline

```
load_dataset()              → pull pick_features rows where source='live'
  └─ filter_for_market()    → market_type match + resolved + outcomes present
     └─ temporal_split()    → train ≤ today-30d, test > today-30d (no leakage)
        └─ build_X()        → derive xwoba_diff, ops_diff, implied_prob, etc.
           └─ MarketModel   → XGBClassifier.fit() + PlattCalibrator.fit()
              └─ evaluate   → brier, log-loss, ROI(Kelly 25%) on test set
                 └─ save    → artifacts/{market}.pkl + manifest.json
```

The full pipeline runs in `~30 seconds` for 500 picks. Manifest gets
written so `/health` and `/calibration` can report current state.

### Run locally

```bash
cd ml
pip install -r requirements.txt

# Train against a CSV exported from the Node API
python -m hexa_ml.train --csv ../data/picks-dataset-2026-05-13.csv

# Or train directly from Postgres
export DATABASE_URL="postgres://..."
python -m hexa_ml.train

# Train just one market
python -m hexa_ml.train --market moneyline
```

### Run the server

```bash
uvicorn hexa_ml.serve:app --reload --port 8000
# → http://localhost:8000/health
```

## Tests

```bash
pip install -e ".[dev]"
pytest tests/ -v
```

Tests cover:
- **Features**: feature ordering, derived computations, missing-column handling, American-odds conversion
- **Data**: market filtering, target construction, temporal split correctness, CSV round-trip
- **Calibration**: Brier / log-loss bounds, Platt monotonicity, Kelly ROI sanity checks
- **Models**: end-to-end training + persistence + reload + inference for all 3 markets
- **Serve**: `/health` always 200, bearer auth required when token set, 503 when artifacts missing

## Deployment

Railway service separate from the Node API. Both services read the same
Postgres via `DATABASE_URL`. Sidecar private URL is injected into the
Node service as `HEXA_ML_API_URL`.

### Required env vars

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Read-only access to `pick_features` for training |
| `HEXA_ML_INTERNAL_TOKEN` | Shared secret for `Authorization: Bearer` |
| `PORT` | Set automatically by Railway |
| `LOG_LEVEL` | `info` by default |

### Weekly retrain

`.github/workflows/retrain-weekly.yml` runs every Sunday at 06:00 UTC,
hits the sidecar's `POST /retrain` with the internal token, then verifies
`/health` reports at least one model loaded. Manual `workflow_dispatch`
supported with a market dropdown.

### Acceptance criteria (Sprint 2)

- ✅ `curl $HEXA_ML_API_URL/health` returns 200
- ☐ `POST /predict/batch` with 10 games returns in < 500ms (requires deploy)
- ☐ Brier score moneyline < 0.24 on real data (requires real training set)
- ☐ ROI Kelly-25 positive on test set (requires real training set)

Items requiring real data become testable once Sprint 1 backfill has run
in production and the slate has accumulated > 100 resolved picks per market.

## Frozen surface

The sidecar **NEVER** mutates anything in Postgres. It reads `pick_features`
and writes to its own `artifacts/` directory only. The Oracle stack
(`server/oracle.js`, `context-builder.js`, `xgboostValidator.js`) is
untouched. The Node integration in Sprint 3 introduces a new fallback
path; the existing deterministic validator stays as the failsafe.
