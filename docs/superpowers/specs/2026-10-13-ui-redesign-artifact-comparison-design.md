# UI Redesign, Interactive Artifact and Cost/Speed Comparison: Design

Date: 2026-10-13
Status: Draft for review
Amends: `2026-10-13-cdm-research-agent-design.md` (the original spec). Where the two conflict, **this document wins**, specifically over the original's "UI" section (Section 9) and its "Non-goals". Everything else in the original spec stands.

## 1. Purpose

Three connected changes to the working app:

1. **A new UI** built on Nexus UI (shadcn registry, Tailwind CSS v4), with a sidebar of the visitor's past research sessions and a report canvas that stays closed until a report exists.
2. **An interactive artifact**: a final pipeline step in which Muse turns the finished report into a self-contained interactive HTML/CSS/JS page, shown in a sandboxed frame.
3. **A cost-and-speed comparison**: after a run, a modal that estimates what the same run would have cost and how long it would have taken if a single model had done every step, versus this harness's mixed-model approach.

### Success criteria

- A visitor sees a polished, Nexus-UI-style interface: a centred prompt on the home screen, a streaming thread with a step-by-step timeline, and a report that is pleasant to read.
- The sidebar lists this browser's past runs; selecting one opens it; "New research" starts another.
- The canvas is closed on arrival, opens by itself when the report is ready, and can be collapsed and reopened.
- Citations in the report (`[1]`) show a hover preview of the source.
- The interactive artifact never delays the report, cannot reach the visitor's page, cookies or the network, and its failure never fails the run.
- The comparison modal shows the harness's **actual** cost and time next to **estimates** for other models, computed from this run's own recorded token counts and clearly labelled as estimates, with the assumptions visible.

### Non-goals

- Follow-up questions or multi-turn conversation (each prompt is a new session).
- Deleting or renaming sessions; accounts or cross-device session sync.
- Comparing answer **quality** between models (the modal compares cost and speed only, and says so).
- Streaming the artifact piece by piece (half an HTML page is neither useful nor safe to run).
- Shareable public links for artifacts; any artifact network access.

## 2. Decisions

| Area | Decision |
|---|---|
| Component library | Nexus UI via `npx shadcn@latest add @nexus-ui/<component>`; shadcn/ui primitives; Tailwind CSS v4; Nexus defaults as the visual baseline |
| Nexus components used | `prompt-input`, `suggestions`, `thread`, `message`, `chain-of-thought`, `citation`, plus its text-shimmer dependency |
| shadcn components used | `sidebar`, `sheet`, `tabs`, `dialog`, `button`, `badge`, `tooltip`, `scroll-area`, `collapsible`, `accordion`, `skeleton`, `separator`, `dropdown-menu`, `sonner` (exact set is whatever the CLI resolves) |
| Theme | shadcn neutral tokens, light and dark with a toggle (`next-themes`) |
| Typography | Sans (Geist) for the interface; a serif (Source Serif 4) for report body text; `@tailwindcss/typography` for prose |
| Artifact placement | An in-run, time-boxed final stage (approach A), not a separate endpoint |
| Artifact capabilities | HTML, CSS and JavaScript, sandboxed with no network |
| Session definition | One research run; listed per device cookie |
| Comparison speeds | Measured by a benchmark script through the operator's OpenRouter key and stored with a date; never invented |

The old UI files (`PromptForm`, `Timeline`, `ChatThread`, `ReportCanvas`, `Markdown`, `RunScreen`, `globals.css`) are replaced. The event stream, reducer, hooks and API routes are kept and extended.

## 3. Pipeline and data changes

### 3.1 New events

Old stored runs replay unchanged because none of these are required.

| Event | Payload | When |
|---|---|---|
| `sources_ready` | `sources: {n: int >= 1, url, title, snippet}[]` | After gathering, before the report is written |
| `artifact_started` | none | Before the artifact request |
| `artifact_done` | `html: string` (the hardened document) | Artifact accepted |
| `artifact_failed` | `reason: string` | Skipped, timed out, invalid or errored |

`sources_ready` carries the authoritative numbering. The report prompt already numbers sources by the order of the gathered summaries; the UI must use this event, not guess the order from fetch-completion order.

### 3.2 Pipeline order

plan → gather → `sources_ready` → report (`report_delta`s) → `report_done` → `tldr_done` → artifact → `run_finished`.

The report and TLDR are visible, and the canvas has opened, before the artifact begins. `run_finished` is emitted after the artifact stage ends either way.

### 3.3 The artifact stage

- **Input:** the finished report markdown and the numbered sources (`n`, title, URL). The prompt marks both as untrusted data.
- **Model call:** Muse, no tools, reasoning effort `low` (new `config.reasoning.artifact`), generous `maxTokens` (16,000, which includes reasoning tokens), its own per-call timeout. New stage name `artifact` in the model-call record.
- **System prompt requirements:** output one complete HTML document; inline CSS and JS only; no external resources of any kind (no fonts, images, scripts, stylesheets, links); no clickable external links (sources are shown as text with their domain); responsive; honours `prefers-color-scheme`; real interactivity (tabs, filters, expandable sections, sortable tables, simple inline-SVG charts); cites sources by number.
- **Time box:** the stage runs only if at least `config.artifact.minRemainingMs` (100 s) of the run budget remains, and is given a deadline of `min(remaining - 15 s, 150 s)`. Otherwise it emits `artifact_failed` with a reason such as "skipped: not enough time left". A failure of any kind emits `artifact_failed` and the run still finishes.
- **Acceptance rules:** strip a surrounding markdown code fence; require an HTML document (a `<!doctype html>` or `<html` marker); require length at most 150,000 characters; otherwise `artifact_failed("invalid output")`.
- **Hardening (stored with the HTML, so a downloaded copy keeps it):** remove `<base>` tags and `<meta http-equiv="refresh">`; insert a Content-Security-Policy meta tag at the top of `<head>` (creating a head if needed): `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`. The policy and the sandbox are the controls; the tag removals are defence in depth, and no claim is made that regex sanitization is sufficient.

### 3.4 Where the artifact is rendered

`<iframe sandbox="allow-scripts" srcdoc=... referrerpolicy="no-referrer">`, **without** `allow-same-origin`, `allow-top-navigation`, `allow-popups`, `allow-forms`, or `allow-modals`. The frame therefore has an opaque origin: no access to the host page, its DOM, cookies or storage; it cannot navigate the host, open windows, submit forms, or (via the policy) make network requests. A script that burns CPU can still slow the visitor's tab; this is accepted.

### 3.5 Sessions API

`GET /api/runs`: the runs whose session's `device_id` equals the request's device cookie (nothing is returned without that cookie), newest first, at most 50. Each item is `{id, prompt, status, startedAt}` with status `running`, `finished` or `failed`. Stale runs are reaped first, as in the replay route. No cross-device listing exists, so clearing cookies loses the list; each run's URL still works.

### 3.6 Cost reservation and limits

The artifact adds one Muse call per run. The per-run budget reservation (`reserveUsdPerRun`) is recalibrated from a real live run after this ships; it stays configurable. The artifact does not change quotas.

## 4. UI structure

### 4.1 Shell

A shadcn Sidebar on the left, the main column in the centre, and the canvas as a right-hand panel. The sidebar persists across navigation (it lives in the root layout). It contains: a "New research" button, the session list (prompt as title, truncated; a status dot for running, done or failed; relative time; the current session highlighted), a theme toggle, and the privacy note. On narrow screens the sidebar is an off-canvas drawer and the canvas is a full-height sheet.

The session list refreshes when a run starts, when it ends, when navigating, and when the window regains focus.

### 4.2 Home (`/`)

A centred heading, a Prompt Input (Enter submits, Shift+Enter newline, 3 to 2000 characters, counter), and Suggestions chips that fill the prompt. Submitting starts a run and replaces the URL with `/run/<id>` as today.

### 4.3 Run (`/run/[id]`)

A Nexus Thread containing the user's prompt as a user Message and one assistant Message:

- **Chain of Thought** with steps Plan, Search, Read, Write and Interactive view. Each step has a status (pending, active, completed, error), the active step shimmers, and steps expand:
  - Plan: each round's queries with score bars and bands (vague, focused, precise); a note when the scoring cap was hit.
  - Search: each query with its result count.
  - Read: each page with a relevance meter or failure reason, and its summary text when available.
  - Write: progress while the report streams (the report body itself is not shown here).
  - Interactive view: building, ready, or failed with the reason.
- The **TLDR** card when available.
- A **"Report ready" chip** that reopens the canvas, and, once the run has finished, actions: Copy, Download .md, **Compare cost and speed**.
- Interrupted and failed states keep their explicit messages; a stream that ends without a terminal event is never shown as done.

The Thread keeps the stick-to-bottom behaviour. The run page has no prompt input at the bottom (follow-ups are a non-goal); starting another research is done from the sidebar.

### 4.4 Canvas

Closed on arrival. It opens automatically on `report_done` and has a collapse control; a collapsed canvas can be reopened from the chip. It is resizable on desktop. Tabs: **Report** and **Interactive view**.

- **Report tab:** serif prose with styled headings, lists, tables, quotes and code; markdown rendered with raw HTML disabled, safe links (`noopener noreferrer nofollow`), no remote images. Inline `[n]` markers become Nexus Citation chips whose hover preview comes from `sources_ready`; the model's trailing "## Sources" markdown section is replaced by source cards (favicon, title, domain). Unknown or out-of-range markers are left as plain text.
- **Interactive view tab:** a shimmer while the artifact builds; the sandboxed frame when ready; the failure reason when it failed or was skipped; a "Download .html" action.

### 4.5 Reducer and types

`RunView` gains `sources` and `artifact: {status: 'idle' | 'building' | 'ready' | 'failed'; html?: string; reason?: string}`. The reducer rules (sequence ordering, duplicate and gap handling, terminal events) are unchanged. Old runs without the new events render with no source cards, plain `[n]` text, and an idle or absent artifact tab.

## 5. Cost and speed comparison

### 5.1 What the modal shows

A dialog opened from the "Compare cost and speed" button, which appears only after the run has finished (final costs exist only then). A table:

| Row | Cost | vs harness | Time | vs harness |
|---|---|---|---|---|
| This harness (mixed models), badge **Actual** | measured | 1x | measured | 1x |
| Muse Spark 1.3, badge **Estimate** | estimated | ratio | estimated | ratio |
| Claude Haiku 5.5, Sonnet 5.5, Opus 5.5; GPT-6 Luna, GPT-6 Sol | estimated | ratio | estimated | ratio |

The candidate list is configuration (`src/lib/comparison/models.ts`). The harness row expands to a per-stage breakdown (stage, model, calls, tokens, cost). A "How this is estimated" section lists the assumptions below, "prices as of" and "speeds benchmarked on" dates, and these caveats: search and page fetching are identical in every row and excluded; quality is not compared; reasoning models may use extra tokens that are not modelled.

### 5.2 Method (all from this run's recorded data)

Inputs: the run's `model_calls` rows (stage, model, input tokens, output tokens, cost, latency) and the first and last event timestamps (wall clock).

**Cost.** For each stage, the alternative model processes the same input tokens as the harness's call did. Output tokens: the harness's measured output for generative stages (plan, summarize, report, TLDR, artifact); a fixed 20 per call for the classification-style stages (query scoring, relevance judging), since a general model would answer those in a few words. Cost is tokens times the candidate's live per-token price. The harness row is the recorded sum, not an estimate.

**Time.** The model-time of a stage is its calls arranged as the run actually arranged them: plan calls sequential; query scoring in parallel per round; per-page judge-then-summarize chains with the configured fetch concurrency; report, TLDR and artifact one call each. For the harness, per-call time is the measured mean. For an alternative, per-call time is `first-token latency + output tokens / tokens-per-second` from the benchmark. The non-model remainder (search, page fetching, overhead) is the measured wall clock minus the harness's modelled model-time, floored at zero, and is added unchanged to every row, so only model work differs between rows. The harness row shows the measured wall clock.

**Prices.** Live from the OpenRouter models listing, cached in memory for 6 hours, with a committed snapshot file as fallback if the fetch fails. A candidate missing from both is omitted.

**Speeds.** A script, `scripts/benchmark-models.ts`, sends the same fixed generation prompt to each candidate through the operator's OpenRouter key, three trials each, streaming, and records the median first-token latency and tokens per second with the date, into a committed JSON file. A candidate with no benchmark shows "n/a" for time and still shows cost. The script also refreshes the price snapshot.

### 5.3 API

`GET /api/run/[id]/comparison`: 404 for an unknown run, 409 with `{error: 'not_finished'}` if the run has no `run_finished` event, otherwise `{harness: {costUsd, wallMs, stages[]}, alternatives[], assumptions, pricesAsOf, benchmarkedAt}`. It returns only aggregates (token counts, costs, times), never prompts or page text. The estimate is a pure function of its inputs so it can be tested with fixed data.

## 6. Security and privacy

- The artifact threat model, controls and accepted residual risk are in 3.3 and 3.4. The artifact is rendered only in the sandboxed frame; the host never injects it into its own DOM.
- `GET /api/runs` reveals only runs tied to the caller's own device cookie. Run URLs remain unguessable UUIDs that anyone holding the link can open, as before.
- The comparison endpoint exposes aggregates only.
- The privacy notice remains in the interface, now in the sidebar footer.

## 7. Testing

Unit tests (written first):

- Artifact: fence stripping; acceptance rules (empty, no HTML marker, over 150,000 characters, valid); hardening (CSP inserted with and without a head; `<base>` and meta-refresh removed; idempotent); the stage with fakes (success, invalid, too large, skipped for lack of time, Muse error, timeout), in each case asserting the run still ends with exactly one `run_finished` and that failures emit `artifact_failed`.
- Reducer: the new events; old event sequences unchanged; `artifact` and `sources` states.
- Sessions: the store query returns only the caller's device, newest first, limited to 50; the route returns nothing without a cookie; stale runs are reaped.
- Comparison: the math on fixed `model_calls` fixtures (cost per candidate, the classification-stage output assumption, parallelism arrangement, the non-model remainder floored at zero, missing benchmark gives n/a, missing price omits the row); price cache and snapshot fallback; the 409 and 404 paths.
- Citation transform: `[n]` inside text becomes a citation node; out-of-range and unknown markers stay text; markers inside code are untouched; the trailing Sources section is detected and removed only when it is the final section.

End-to-end (Playwright, scripted backends):

- Home shows the prompt input and suggestions; submitting streams the timeline.
- The canvas is closed at first, opens when the report is ready, collapses, and reopens from the chip.
- The sidebar lists sessions, highlights the current one, and navigates; "New research" returns home.
- The interactive tab renders the fake artifact inside a frame whose `sandbox` is exactly `allow-scripts`; a click inside the frame changes content (interactivity works); a script in the fake artifact that tries `fetch` to the host and reads `document.cookie` and `parent.document` is shown to fail.
- The comparison modal opens after the run finishes and shows the harness row and the alternatives.

Visual quality is reviewed during implementation using Playwright screenshots in light and dark, desktop and mobile widths; screenshots are review aids, not assertions.

## 8. Dependencies and tooling

Added: Tailwind CSS v4, `@tailwindcss/typography`, shadcn/ui configuration (`components.json`), the Nexus UI components above and their dependencies (Radix, `@hugeicons/*`, `tw-shimmer`, `use-stick-to-bottom`, `tldts`, carousel and hover-card), `next-themes`, `sonner`. The existing plain CSS and the components it styled are removed. Server code, the SSE protocol and persistence keep working; only the events listed in 3.1 and the stage name `artifact` are added.

## 9. Open items for the first implementation tasks

1. Confirm the Nexus UI installation works on this project's Next.js 16 and React 19 (install the first component and build) before building on it.
2. Measure the real artifact latency and cost with a live run; set `artifact.minRemainingMs`, the artifact deadline and `reserveUsdPerRun` from the numbers.
3. Run the benchmark script to produce the speeds file; review the candidate list.
4. Still outstanding from the original spec: a `TAVILY_API_KEY`, confirmation of the Vercel function duration, and the deployment itself.
