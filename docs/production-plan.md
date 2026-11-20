# Assessing the assistants in production

Evals on staging answer "is this release good enough to ship?". Production needs a different question answered
continuously: **"is it still good, for real visitors, right now?"** Models change, prompts drift, traffic brings
questions nobody wrote a test for, and costs can creep.

This is a phased plan. Each phase is useful on its own and builds on the last.

## Phase 1: release gate (done)

Before tagging a release of any site with an assistant, run `npm run eval` against staging. A failing critical test
blocks the release; a flaky one gets fixed or explained. This is in the hub's `docs/conventions.md`.

## Phase 2: nightly synthetic evals against production

Run a small, read-only subset of the suites against production every night, and alert on failure. This is the AI
version of a synthetic uptime check: it catches silent model changes, broken deploys and drift.

- **What:** the critical tests only, 2 repeats, about 40 requests a site, well under the 500-a-day Gemini cap per
  instance and the 10-a-minute rate limit.
- **Where:** a Cloud Run job (this repo's container), triggered by Cloud Scheduler, running as a service account
  with Vertex AI User for the judge.
- **Results:** the summary JSON to Cloud Storage or BigQuery, so pass rates can be charted over time.
- **Alerts:** a log-based alert in Cloud Monitoring when the job exits non-zero.
- **Cost:** about 120 assistant calls and 80 judge calls a night with flash and flash-lite models: cents a month.

## Phase 3: tracing (see what the model actually did)

Instrument each backend with OpenTelemetry using the GenAI semantic conventions. That means a span per model call
with `gen_ai.request.model`, `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens`, plus `execute_tool`
spans for lesspane's tools. Export to Cloud Trace (already part of Google Cloud) or to a self-hosted Langfuse.

- **What it unlocks:** latency and token cost per conversation; tool-call trajectories (did the assistant call
  `estimate_price`, or guess?); debugging a bad answer from its trace instead of trying to reproduce it.
- **Privacy:** prompt and response text are *not* captured by default in the conventions, and should stay that way
  for lesspane, where messages contain names, emails and addresses. Capture content only for sampled traces,
  redacted, with a short retention period.
- **Caution:** the GenAI conventions are still at Development status (they moved to their own repository in June
  2026), so pin instrumentation versions and expect renames.

## Phase 4: online evaluation (grade real conversations)

Sample a small share of real conversations (say 5%, redacted), and grade them with the same rubrics as the suites:
grounded, no invented facts, policy followed, no leaked instructions. Chart the pass rate per rubric. A drop is a
signal to read those conversations and turn them into new eval tests.

- **Tools:** Vertex AI's Gen AI evaluation service (managed, adaptive rubrics, agent trajectory metrics) fits the
  existing Google Cloud setup. Langfuse's online evaluators are the open-source alternative.
- **Judge hygiene:** use the same calibrated judge and rubrics as `suites/judge-calibration.yaml`; recalibrate on
  real samples labelled by hand.

## Phase 5: feedback and the data flywheel

Add thumbs up and down to each chat panel, stored with the (redacted) conversation. Every thumbs-down and every
failed online grade is a candidate test case: review it, label it, add it to a suite, fix the assistant, and the
test stays to keep it fixed. Over time the suites come to reflect what real visitors ask.

## What to watch

| Signal | Source today | Why |
| --- | --- | --- |
| Error rate (HTTP 503 from the chat endpoints) | Cloud Run logs | Gemini failures, quota, deploy problems |
| Rate limits hit (429) and daily caps hit (503 "answered all it can") | Cloud Run logs | Abuse, or limits set too low |
| Latency per answer | Cloud Run metrics, then traces | Slow answers lose visitors |
| Tokens and cost per conversation | Traces (phase 3) | Cost creep from longer prompts or loops |
| Nightly eval pass rate | Phase 2 | Silent model or prompt regressions |
| Online grade pass rate, per rubric | Phase 4 | Quality on real traffic |
| Thumbs-down rate; LessPane bookings per conversation | Phase 5 / Firestore | Is the assistant actually useful? |

## Model lifecycle

Gemini models are retired on a schedule (see each project's `AGENTS.md`). Before switching model, run the full
suites with 10 repeats on both the old and the new model and compare pass rates per test. The model is just another
change, and the evals are the regression test for it.
