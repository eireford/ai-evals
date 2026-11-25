# ai-evals

Evaluations for the three AI assistants Eire Ford runs in production:

| Site | Assistant | What it must get right |
| --- | --- | --- |
| [eireford.com](https://eireford.com) | Answers questions about the résumé (Micronaut, Java) | Facts, dates, the degree being in progress, no invented certifications or pay |
| [wedocompute.com](https://wedocompute.com) | Support assistant for a one-person practice (FastAPI, Python) | The four services, no prices, no implied team, job questions → the résumé |
| [lesspane.com](https://lesspane.com) | Quotes, explains and books window cleaning, with tools (SvelteKit, Node) | Exact prices, service area, policies, never booking without a yes |

All three use Gemini on Vertex AI, so their answers vary from run to run. These evals test them the way a visitor
does, over HTTP, and decide pass or fail from several runs instead of one.

**Start with [docs/learning-guide.md](docs/learning-guide.md)**: it explains the approach (why repeated runs, which
assertion to use when, how to trust an AI judge) and the 2026 tool landscape. The production side is in
[docs/production-plan.md](docs/production-plan.md).

## Run it

Needs Node 22.22+ and Google credentials for the judge (`gcloud auth application-default login`; the judge calls
Gemini on Vertex AI in `EVAL_GCP_PROJECT`, default `eireford-com`).

```bash
npm ci
npm test                          # unit tests: statistics and the pricing oracle (no network)
npm run eval                      # judge calibration, then all three sites against staging, 3 runs per test
npm run eval:lesspane             # one suite
EVAL_TARGET=production npm run eval -- eireford
EVAL_REPEAT=10 npm run eval -- judge
npm run view                      # browse every answer and grade in promptfoo's web viewer
```

Targets: `staging` (default), `production`, `local`. The booking tests (`lesspane-local`, `lesspane-agent`) create
bookings, so they run only against a local LessPane dev server: `EVAL_TARGET=local npm run eval -- lesspane-local`.

**`lesspane-agent`** (`npm run eval:agent`) tests LessPane from the other side: a real model (Gemini) plays a
person's own AI assistant and orders through LessPane's MCP server, as an outside agent would
(`lesspane/docs/agent-ordering-plan.md`). The provider returns `{text, calls}`, so the checks look at what the agent
did (which tools, with what arguments, how many bookings), not only what it said. It caught two real problems on its
first runs: a "next Tuesday" booked on a Wednesday, and retries matched by a guessable request id. Both are fixed in
LessPane. Its MCP requests are paced under LessPane's 20 a minute, and each run cancels its own bookings.

Each site allows 10 chat requests a minute per IP, so tests run one at a time, about 6.5 seconds apart. A full
staging run with 3 repeats takes about 25 minutes and costs a few cents of Gemini.

## How a run decides

1. **Judge calibration** runs first: the judge grades fixed answers whose verdict a human already decided. If the
   judge disagrees with a human, its grades of the real answers aren't trustworthy.
2. **LessPane's pricing oracle** is checked against the live landing page, so price tests never grade against stale
   prices.
3. **Each test runs N times** (`EVAL_REPEAT`, default 3). **Critical** tests (facts, prices, safety) must pass every
   run. **Quality** tests must pass at least 2 of 3. A test that passes some runs and fails others is reported as
   flaky, because an assistant that is right only sometimes is a bug. `scripts/stats.mjs` holds the rules, and the
   report shows a 95% confidence interval to make small samples honest.

Results go to `results/` (git-ignored): promptfoo's full JSON per suite, and `summary-<target>-<time>.json`.

## Layout

| Path | What it is |
| --- | --- |
| `providers/site-chat.mjs` | The one provider for all three sites: their APIs, pacing, 429 retries, multi-turn history |
| `providers/mcp-agent.mjs` | Gemini as a customer's own assistant, ordering from LessPane over MCP (local only) |
| `suites/*.yaml` | Test suites: questions, assertions, judge rubrics |
| `suites/lesspane-price-tests.mjs` | Price tests generated from the oracle, each job asked several ways |
| `fixtures/lesspane-pricing.mjs` | The pricing oracle: an independent copy of LessPane's formula |
| `scripts/run.mjs` | Runs suites with repeats, checks the oracle, reports |
| `scripts/stats.mjs` | Pass/fail rules for repeated runs, Wilson intervals |

## Adding a test

Add an entry to a suite with a `description`, `vars.question`, `metadata` (`category`, `critical`) and assertions.
Prefer the cheapest assertion that can catch the failure: `icontains`/`regex` before `llm-rubric`. Write rubrics
that say what fails ("Fails if …", "Gives no price"), and add a near-miss example of the new rubric to `suites/judge-calibration.yaml`.
When a real conversation goes wrong, turn it into a test before fixing it.

Built with [promptfoo](https://www.promptfoo.dev/) 0.125 (MIT). The suites are plain YAML and a small provider, so
they can move to another tool if needed.
