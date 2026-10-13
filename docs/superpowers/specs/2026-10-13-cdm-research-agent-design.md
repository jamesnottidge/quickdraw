# CDM Research Agent: Design

Date: 2026-10-13
Status: Draft for review

## 1. Purpose

A public, no-account web app that runs a research pipeline in which a general LLM handles only the judgment-heavy steps (planning queries, writing the report) and ScaleDown's small task-specific models handle everything else (scoring queries, judging page relevance, summarizing, producing a TLDR). The app streams every stage to the user.

It is also an experiment: every run is stored in enough detail that the pipeline can be evaluated and re-run later with different models, rubrics and thresholds.

### Success criteria

- A visitor with no account enters a prompt and watches each stage happen live, then reads a report in a canvas sidebar with a TLDR in the chat thread.
- No partial streamed data is ever acted on or rendered as if complete (Section 6).
- Every run is stored with its config snapshot, every event, every raw model request/response, and the extracted page content, so stages can be replayed offline.
- A public deployment cannot exceed the $5/day global spend cap, the per-device/IP quota, or the search budget.
- Reconnect attempts to in-progress runs are counted, so we can decide whether to build durable runs (Section 11).

### Non-goals (YAGNI)

- Accounts, auth, billing.
- The eval harness itself (the schema supports it; building it is a later project).
- Human labels or feedback UI.
- Durable/resumable runs (decided from reconnect data).
- Live reconnect to an in-progress stream (a reopened in-progress run shows stored events so far, not a live tail).

## 2. Decisions

| Area | Decision |
|---|---|
| Planner/writer LLM | `meta/muse-spark-1.3-contributor` via OpenRouter, configurable. $0.10/$0.20 per 1M tokens, tools and streaming supported. Prompts may be used to improve Meta's products; the UI shows a notice |
| Query scoring, relevance | `scaledown/classify-1` via OpenRouter Decisions API |
| Summaries | `scaledown/summarize` via OpenRouter chat completions |
| TLDR | `scaledown/extract` by default; `scaledown/summarize` ("one sentence") is a one-line config swap. Compare in evals |
| Search | Tavily, search endpoint only, behind a `SearchBackend` interface. SearXNG added later as a second backend. Tavily extract is never used |
| Page content | Our own fetch + extraction flow |
| Hosting | Vercel (Next.js), Supabase Postgres |
| Auth | None. Cookie device id + salted IP hash |
| Run architecture | One streaming route handler runs the whole pipeline (approach A) |
| Limits | 5 runs/device/day (configurable; IP limit ~3x), $5/day global spend cap, search-call budget |

One OpenRouter key covers all four model calls. A Tavily key is the only other credential.

`openai/gpt-6-luna:batch` was rejected: `:batch` variants are the asynchronous Batch API (24h window, `stream: true` rejected) and cannot serve an interactive app. `:batch` remains useful for bulk eval replays.

## 3. Architecture

### Units

| Unit | Responsibility | Depends on |
|---|---|---|
| `models/chat` | OpenRouter chat calls: Muse (streaming, tools), `extract`, `summarize` | OpenRouter key |
| `models/decisions` | `scaledown/classify-1` via `POST https://openrouter.ai/api/alpha/decisions`. Exposes `scoreQueries()` and `judgeRelevance()` | OpenRouter key |
| `search/` | `SearchBackend` interface returning `{url, title, snippet}[]`; Tavily implementation | Tavily key |
| `fetch/` | SSRF-safe fetch, size/time caps, content-type routing (Section 5) | `models/chat` |
| `pipeline/` | Stages as async generators yielding typed events | all of the above |
| `events/` | zod discriminated union of all UI events, shared server and client | none |
| `store/` | Postgres access (Section 8) | none |
| `limits/` | Quota, spend cap, search budget, worst-case reservation | `store` |
| `app/api/run` | Streaming route: checks limits, runs the pipeline, forwards events to client and `store` | all |
| `app/` UI | Chat column with stage timeline, report canvas | `events` |

### Data flow for one run

1. Route checks limits and opens a run, reserving worst-case cost.
2. Plan loop (Section 4): Muse alternates with `score_queries` until it calls `submit_queries` or hits the 3-round cap.
3. Search runs for the submitted queries. `fetch` retrieves result pages in parallel.
4. `judgeRelevance` runs per page; only relevant pages continue.
5. `summarize` runs per relevant page, in parallel.
6. Muse writes the report from the summaries (streamed).
7. TLDR is produced.
8. Every event and every raw model call is persisted as it happens. The run ends with `run_finished` or `run_failed`.

## 4. The plan loop

Muse gets exactly two tools:

- `score_queries({queries})`: returns, per query, a specificity score from a 4-level rubric, plus confidence, rounded to one decimal with a band label (vague / focused / precise). Backed by one Decisions request per query, run in parallel.
- `submit_queries({queries})`: terminates the loop. Ending on a dedicated tool call avoids parsing prose.

Rules:

- Classify scores vary by roughly 0.2 across identical calls (Section 10). The system prompt tells Muse to revise anything below "focused" and to ignore score differences smaller than 0.3.
- Maximum 3 scoring rounds. After the cap, the best-scoring queries are submitted and the event log records that the cap was hit.
- Maximum 8 queries per run.
- A tool call is executed only after its arguments are complete (Section 6). Invalid arguments are returned to the model as a tool error.

## 5. Search and fetch

- `SearchBackend` returns URLs and snippets; the pipeline fetches pages itself.
- `fetch/` pipeline: allow only http/https; resolve DNS and block private, loopback, link-local and cloud-metadata addresses; re-check every redirect hop with a hop cap; enforce size and time limits while streaming the body.
- HTML: Mozilla Readability, then Turndown, to markdown.
- PDFs and images: sent to `extract`/`summarize` as `file` / `image_url` content parts (data URLs). The documented top-level `document` field is silently ignored by OpenRouter and must not be used.
- Extracted markdown is stored in `pages`, capped at about 200k characters per page; at most 30 pages per run.
- Fetch failures emit `page_failed` and do not fail the run.

## 6. Streaming and partial-data handling

Rule: nothing acts on anything incomplete. Three layers:

**Transport (SSE).** Each SSE frame is one complete JSON event. The client parser buffers until the blank line terminating a frame, since network chunks do not align with frames, and decodes with a streaming `TextDecoder` so multi-byte characters split across chunks are not corrupted.

**LLM tool calls.** Muse tool-call arguments arrive as fragments in OpenRouter's OpenAI-compatible SSE stream (`delta.tool_calls[].function.arguments`). We parse that stream ourselves with a small accumulator (not the Vercel AI SDK, whose v7 stream API was changed and could not be verified; this keeps the partial-call rule in our own tested code). Fragments are assembled per tool-call index, and a call is surfaced as complete only when the stream finishes and its arguments parse as JSON. Tools run only for complete calls. The UI may show a "drafting queries" state while arguments stream, which is display only. Malformed or truncated arguments never execute; they become a tool error returned to the model. **Muse tool-call streaming has not been tested against the real API; capturing a real stream as a test fixture is the first implementation task.**

**Event stream.** Every event carries `{runId, seq, ts, type}`. The client reducer applies events in `seq` order and ignores duplicates and replays. Every run ends with `run_finished` or `run_failed`; a stream that ends without one is shown as "interrupted", never "done".

**What streams and what doesn't.** `classify-1`, `extract` and `summarize` are called non-streaming: extract returns its result as a JSON string that must be parsed whole. Only Muse streams token by token. The report canvas appends `report_delta` events through a markdown renderer that tolerates unclosed fences and half-written tables. A final `report_done` event carries the complete text and replaces the accumulated version, so the stored report is authoritative.

## 7. Limits and budget

Enforced in the route before any model call.

- Per-device daily run quota (default 5, configurable). Per-IP quota about 3x. A run is blocked if either is exceeded.
- Global daily spend cap: $5, a config value changeable without redeploy. At run start the route atomically reserves a worst-case cost (initial guess $0.15, tuned from measured totals) with a single conditional SQL update on the day's ledger row, so simultaneous starts cannot overshoot. On completion the reservation is replaced by actual spend summed from each response's `usage.cost`.
- Each run row stores its reservation (`reserved_usd`, `reserved_searches`, ledger day) and a `settled` flag; settlement is idempotent. If Vercel kills a function at its time limit, the settlement never runs, so each new run first reaps stale `running` runs (older than the max function duration plus a margin): they are marked failed and their reservation is settled using the actual cost summed from `model_calls`.
- Search-call budget tracked the same way (Tavily's allowance is 1,000 credits/month; SearXNG is expected to replace it first).
- Per-run hard limits: 8 queries, 30 pages, 200k characters per page, maximum report length, overall wall clock set from the confirmed Vercel plan duration (to be checked).
- Limit hits return a plain message; nothing is spent.

## 8. Identity and storage

Identity: a first-visit httpOnly cookie holds a random `device_id`. The IP comes from Vercel's forwarded headers and is stored as a salted hash, not raw.

| Table | Holds |
|---|---|
| `sessions` | device id, IP hash, user agent, first/last seen |
| `runs` | prompt, status, config snapshot, timings, total cost, error |
| `events` | `(run_id, seq)` key, type, JSON payload |
| `model_calls` | stage, model, raw request (no headers), raw response, latency, tokens, cost |
| `pages` | URL, fetch status, content type, extracted markdown |
| `reconnects` | run id, session, whether the run was still active, timestamp |
| `spend_ledger` | per UTC day: reserved and actual spend, search calls |

The config snapshot records models, prompts, rubrics, `noul` criteria text, thresholds and loop caps in force for the run. `pages` retention: 90 days.

## 9. Failure handling, security, UI, testing

### Failure handling

- Page fetch failure: `page_failed`, continue.
- Classify or summarize failure: retry once with jitter, then skip that page and record why.
- OpenRouter 429: back off, up to 2 retries.
- No relevant pages survive triage: the run ends with "couldn't find usable sources" and lists the queries tried. No invented report.
- Muse failure or time limit: `run_failed`, release the unused reservation, keep the partial trace.

### Security

- SSRF guard as in Section 5.
- Prompt injection: pages are untrusted. Muse never sees raw page text, only `summarize` output, marked as untrusted data in the report prompt. During report writing Muse has no tools. In the plan loop its tools have no side effects.
- Rendering: raw HTML disabled in markdown, links use `noopener`, remote images in reports are not auto-loaded.
- Keys stay server-side and are never logged or stored in traces.
- UI notice: prompts may be used to improve Meta's models (contributor tier); runs are stored for research.

### UI

- Left: chat thread with a live stage timeline (planning, scoring, searching, reading, summarizing, writing). Query scores, page relevance and summaries appear as they land. The TLDR appears when the run finishes.
- Right: report canvas filling as the report streams; copy and download-as-markdown.
- A finished run's URL replays from stored events.

### Testing

- SSE parser: split a sample stream at every byte offset, including inside multi-byte characters; assert identical output.
- Event reducer: duplicate, out-of-order, missing-terminal-event cases.
- Tool-call assembly: fragmented, malformed and truncated arguments never execute.
- SSRF guard: table of hostile URLs (decimal IPs, IPv6-mapped addresses, DNS rebinding, redirects to private hosts).
- Budget reservation: concurrent starts cannot exceed the cap.
- Model clients: contract tests from real saved responses as fixtures, plus a live smoke test gated on a key being present.
- End-to-end: Playwright against fake model backends, checking the timeline and canvas.

## 10. Observed model behavior (live tests, 2026-10-13)

From a subagent's real requests via OpenRouter; raw responses were saved outside the repo (scratchpad `cdmtest/`). Mostly single runs.

**classify-1** (`POST /api/alpha/decisions`, model `scaledown/classify-1`; `scaledown/classify` is a 400)

- Ranks sensibly: "ai" 0.36, "how does stuff work" 0.72, two precise queries 2.76 and 2.89 on a 0-3 scale.
- Not deterministic: identical requests moved up to about 0.2.
- The research question must go in `instructions` or `criteria`; a `state` object with extra keys returns 400. `noul` criteria must be an object with keys `"true"` and `"false"`; the wording changes the probability substantially (same relevant page: 0.52 without criteria, 0.90 with).
- Cost is linear in questions: state is re-read per question, about $0.00001 per question. 200k characters (about 36k tokens) succeeded in about 2s. Latency typically 0.6-2s with outliers to 10s.

**extract** (chat completions, `scaledown/extract`)

- Only plain-string entity descriptions via `provider.options.scaledown.entities` work. The documented `{labels:[{name, rubric}]}` form returns 400. `response_format` is rejected without `entities` and has no visible effect with it.
- Classification works through plain strings ("Is the account delinquent? yes or no" returned "yes", 0.968).
- Output is non-deterministic (3 entities once, 7 entities three times for the same request, including non-verbatim "Inferred from context" entries). `top_n`/`threshold`/`context_chars` effects were smaller than this noise.
- TLDR-style entities return generated paraphrase, not verbatim spans, with confidence around 0.001, so confidence is not a quality signal for generated text.
- `image_url` and `file` content parts work; top-level `document` is silently ignored. Streaming works; tools/`tool_choice` return 404.

**summarize** (chat completions, `scaledown/summarize`)

- Faithful in the sampled outputs (no fabricated facts found; no invented CEO or founding year when probed).
- Instruction following is uneven: a French system prompt worked, but an English prompt asking for French with exactly 3 bullets produced English prose in four paragraphs.
- Slow on small inputs (9-11s) but not on large ones (5s for about 29k tokens), so pages are summarized in parallel.
- No latency or character-count metadata in the response; only standard `usage`. Streaming works. Cost about $0.000036 per small call, $0.0012 for about 29k tokens.

Caveats: single runs; determinism of summarize untested; classify states over 200k characters untested; PDFs untested.

## 11. Reconnect tracking and the path to durable runs

When a client opens a run that is still in progress, the app serves the stored events so far and writes a `reconnects` row. A dashboard query counts these. If reconnects are frequent, the next step is a durable workflow with a resumable stream (Vercel Workflow or a queue), which would be a separate design.

## 12. Open items for the first implementation tasks

1. Capture a real Muse tool-call SSE stream as a fixture and verify the accumulator against it.
2. Confirm the Vercel plan's maximum function duration and set the per-run wall-clock limit from it.
3. Tune the classify rubrics (query specificity, page relevance) and the worst-case cost reservation from measured runs.
4. Confirm Tavily's free-credit allowance and set the search budget.
5. Decide TLDR model (extract vs summarize) from comparison runs.
