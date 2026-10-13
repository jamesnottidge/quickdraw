# CDM Research Agent

A public, no-account research agent. A general LLM (Muse) plans queries and writes the report; ScaleDown's small
models score queries, judge page relevance, summarize pages and produce the TLDR. Every run is stored for evals.

Each run produces three things: a **report** (with hover citations and source cards), an **interactive view** (a
self-contained page Muse builds from the report, shown in a sandbox), and a **cost and speed comparison** against
running the same job on other models end to end.

Design: `docs/superpowers/specs/2026-10-13-cdm-research-agent-design.md` and
`docs/superpowers/specs/2026-10-13-ui-redesign-artifact-comparison-design.md` (the second wins where they differ).

## Interface

- **Sidebar:** this browser's past research sessions (listed by the device cookie), a "New research" button, a theme
  toggle and the privacy note.
- **Thread:** a live timeline of the run (plan, search, read, write, interactive view) with scores, relevance and
  summaries as they arrive, then the TLDR.
- **Canvas:** closed while the report is written, opens by itself when it is ready, collapsible. Tabs: *Report* and
  *Interactive view*. The interactive view runs in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`,
  plus a Content-Security-Policy stored inside the HTML that forbids all network access and external resources.
- **Compare cost and speed:** after a run finishes. The harness row is actual; other models are estimates computed from
  this run's recorded tokens at their live OpenRouter prices, with speeds from `scripts/benchmark-models.ts`.

## Run locally

    npm install
    cp .env.example .env        # fill in keys
    npm run dev                 # real services
    FAKE_MODELS=1 npm run dev   # scripted offline pipeline + in-memory database

## Tests

    npm test                    # unit tests
    npm run e2e                 # Playwright, fake backends
    npx tsx scripts/live-smoke.ts   # real services, a few cents
    npx tsx scripts/live-run.ts "your question"   # full real run + per-stage cost/latency table
    npx tsx scripts/benchmark-models.ts           # refresh comparison speeds and prices (a few cents)
    npx tsx scripts/live-artifact.ts              # build a real interactive view from a sample report and screenshot it
    npx tsx scripts/screenshots.ts                # screenshot set for visual review (needs a dev server on :3200)

## Environment

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | Muse, classify-1, summarize, extract (one key) |
| `TAVILY_API_KEY` | Search (search endpoint only) |
| `DATABASE_URL` | Postgres (Supabase transaction pooler string) |
| `IP_HASH_SALT` | Salt for hashing visitor IPs (`openssl rand -hex 32`) |
| `CRON_SECRET` | Bearer secret for `/api/cron/prune` and `/api/stats` |
| `DAILY_SPEND_CAP_USD` | Global daily spend cap (default 5) |
| `RUNS_PER_DEVICE_PER_DAY` | Per-device daily runs (default 5; IP limit is 3x) |
| `SEARCH_BUDGET_PER_DAY` | Global daily search calls (default 100; use ~30 on Tavily's 1,000/month free tier) |
| `TLDR_MODEL` | `extract` (default) or `summarize` |
| `PLANNER_MODEL` | Override the planner/writer model |
| `MUSE_PLAN_EFFORT` / `MUSE_REPORT_EFFORT` / `MUSE_ARTIFACT_EFFORT` | Muse reasoning effort: `minimal` (default for planning), `low` (default for report and artifact), `medium`, `high`. Higher is slower |

## Operations

- Reconnect metric (do people reopen in-progress runs? if often, build durable runs):
  `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/stats`
- Spend by stage: `select stage, count(*), sum(cost_usd), avg(latency_ms) from model_calls group by 1;`
- Daily ledger: `select * from spend_ledger order by day desc;`
- Page content older than 90 days is deleted daily by `/api/cron/prune`.
- Changing the maximum function duration: edit `MAX_DURATION_SECONDS` in `src/lib/config.ts` **and** the literal
  `maxDuration` in `src/app/api/run/route.ts` (a test fails if they differ), and keep `maxRunMs` below it.

## Privacy

Runs, fetched pages and model calls are stored. IPs are stored only as salted hashes. The planner/writer model
runs on its contributor tier, so prompts and outputs may be used to improve Meta's products.
