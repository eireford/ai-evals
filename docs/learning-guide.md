# Testing AI that never answers the same way twice

A guide to the approach in this repository: why each piece is there, what the field calls it, and what to read
next. It's written to learn from and to explain in an interview.

## 1. Why AI needs different testing

A normal test asks "is the output exactly X?". An AI assistant breaks that in four ways:

- **Different answers to the same question.** Sampling makes wording vary from run to run. Even at temperature 0,
  hosted models are only *mostly* deterministic: batching, hardware and silent model updates shift outputs. One
  study measured accuracy swings of up to 15% across runs with fixed seeds at temperature 0.
- **Many right answers.** "$210" and "about **$210**" are both right. Exact matching fails good answers.
- **The ground moves.** Models are retired on a schedule (`gemini-2.0-flash` in June 2026,
  `gemini-2.5-flash-lite` in October 2026), and a prompt edit that fixes one answer can break another.
- **The worst failures are rare.** A reply that invents a certification one time in twenty passes most single runs.

So the question changes from "is this output right?" to **"how often is this assistant right on this question,
and is that often enough?"**

## 2. The layers (the testing pyramid for AI)

| Layer | What runs | Model | Where in these projects | When |
| --- | --- | --- | --- | --- |
| Code tests | Tools, validation, prices, limits, prompt assembly | Mocked | `lesspane/src/lib/server/assistant/assistant.test.ts`, `ChatLimitsTest.java`, `test_chat_limits.py` | Every commit (CI) |
| **Evals** (this repo) | Real questions to the real deployed assistant, graded | Real Gemini | `suites/` | Before every release, on staging |
| Production monitoring | Traces, sampled grading of real conversations, feedback | Real | [production-plan.md](production-plan.md) | Continuously |

Push every check as far down as it can go. "The price formula is right" is a code test; "the assistant quotes the
formula's price" needs an eval; "real customers get right prices" needs monitoring.

## 3. Assertions, cheapest first

Each check costs more than the one before; use the first that can catch the failure.

1. **Deterministic checks.** `icontains: eireford@gmail.com`, `not-regex` for a phone number, a word count. They're
   free, exact and never flaky. Most "must"/"must never" rules belong here.
2. **Oracle checks.** Compare with an independent source of truth. LessPane's prices come from
   `fixtures/lesspane-pricing.mjs`, a deliberate *copy* of the formula. Importing the app's own code would agree with
   its bugs. A copy can go stale, so `run.mjs` checks it against the live landing page first. That's
   **oracle drift**, and it gets checked automatically.
3. **Metamorphic tests.** Change the input in a way that shouldn't change the answer, and check that it doesn't.
   "24 windows, two-story, outside only" is asked three ways (formal, casual, with typos), and the price must match
   every time. This catches answers that depend on wording, with no extra ground truth needed.
4. **LLM-as-judge** (`llm-rubric`). Another model grades the answer against a written rubric. It's the only way to
   check meaning ("says the degree is in progress"), but it is itself an AI: slower, costlier and fallible
   (section 4).

## 4. Trusting the judge

An LLM judge is a measuring instrument, so calibrate it before trusting its readings.

- **Use a stronger model than the one being judged**, at temperature 0. Here the assistants run
  `gemini-3.5-flash-lite` and the judge runs `gemini-3.5-flash`.
- **Write rubrics as checklists with explicit fail conditions.** "Fails if it says or implies the degree is already
  completed" grades far more consistently than "is the answer accurate?". Binary pass/fail beats a 1–10 score.
- **Calibrate against human labels.** `suites/judge-calibration.yaml` holds answers whose verdict a human already
  decided, mostly near-misses: a finished degree instead of an expected one, "a small team" for a one-person
  practice, the referral credit going to the wrong person. The judge must agree with every label, repeatedly. It
  runs first in every `npm run eval`.
- **Recalibrate on any change** to the judge model or a rubric. Known judge biases are favouring longer answers,
  favouring its own model family's style, and leniency toward confident tone.

## 5. Non-determinism: repeat, then decide

Each test runs N times (`EVAL_REPEAT`). The rules are in `scripts/stats.mjs`:

- **Critical tests must pass every run.** These are facts, prices and safety. If an invented certification
  happens 1 time in 10, one visitor in ten sees it; that's a bug, not noise to average away.
- **Quality tests need a pass rate** (2 of 3 by default), because "a useful two-sentence summary" is a matter of
  degree.
- **Flaky is a finding.** A test that passes sometimes means the assistant is unreliable on that question. The fix
  is usually a clearer instruction or a tool, not a looser test.
- **Know what N buys you.** The report shows a 95% Wilson interval. With 3 of 3 passes, the true pass rate could
  still be as low as 44%; with 30 of 30, about 89%. Three repeats are a smoke test for each change. For a release
  decision on a risky change, run 10 or more on the critical tests.

Lowering the assistant's temperature (0.2–0.3 here) reduces variance but doesn't remove it. Don't chase
byte-identical output; assert on what matters.

## 6. Black-box testing, and what it can't see

These evals call each site's chat endpoint exactly as its web page does (`providers/site-chat.mjs`). One harness
covers Java, Python and Node, and it tests what users actually get: the deployed prompt, model, limits and error
handling. The cost is that it sees only the final text. It can't confirm that the lesspane assistant called
`estimate_price` instead of doing arithmetic itself. That's why the price check is an oracle comparison: a right
price from mental math is luck. The white-box answer is **trajectory evaluation**, grading the sequence of tool
calls from traces. It's in the production plan, and Vertex AI's evaluation service supports it.

## 7. Side effects: evals must be safe to run anywhere they're allowed

The booking tests (`suites/lesspane-local.yaml`) can create a booking and send email, so the runner refuses to run
them anywhere but a local dev server, where storage is a file and email is printed. Everything that runs on
staging or production is read-only by construction. The second booking test also checks the opposite failure:
never booking before the customer says yes.

## 8. Adversarial testing

Every suite has prompt-injection and off-topic tests. They're a start, not a red team. For breadth, promptfoo's
`redteam` command generates hundreds of attacks (jailbreaks, PII extraction, policy evasion) against a target.
Point it at staging, never production, and treat its findings like the ones in section 9.

## 9. What the first runs found (a case study)

Run 1, against staging on 2026-11-20 with one run per test: the judge agreed with every human label, and 37 of 39
site tests passed. Two failures:

- **wedocompute:** asked "Is Eire available for a full-time job?", it gave the email but not the résumé link.
- **lesspane:** asked "Can you come on a Sunday, and can I pay with Zelle?", it answered only the Sunday part.

Both looked like assistant bugs, and each got a one-line prompt fix (wedocompute-com #15, lesspane #13).

Run 2, with 3 repeats per test after the fixes:

- The wedocompute fix held, 3 of 3.
- The Zelle test still failed 3 of 3, even after a second, more explicit fix tested locally 5 times. A failure that
  survives every fix is a signal to **suspect the test**. Asked about Zelle directly, the assistant listed it
  correctly. The cause was YAML: `{ question: Can you come on a Sunday, and can I pay with Zelle? }` is a flow
  mapping, and the comma split it, so the assistant had only ever been asked about Sunday. Two other questions had
  the same bug.
- Three tests were flaky because their rubrics demanded more than the question asked. One failed "the résumé
  doesn't list AWS or Google Cloud certifications" for not saying "no certifications at all". The rubrics were
  narrowed to the property that matters (no invented certification), and each change got a calibration example.

What was done about it:

- Every question is quoted, and `scripts/suites.test.mjs` now **tests the tests**: no null variables, no
  truncated questions, unique names, and every rubric says what fails. Run against the old suites, it catches the
  original bug.
- The lesspane prompt change was **reverted** (lesspane #14), and the matching extra rule removed from wedocompute
  (wedocompute-com #16), because a fix with no real failure behind it is just prompt bloat. The résumé fix, which
  had a real failure behind it, stayed.

The lessons, which apply to any eval program:

1. **Evals are code, and they have bugs.** A broken eval reports a broken product. Lint and unit-test the suites.
2. **Read the actual output before fixing anything.** The judge's reason ("doesn't mention Zelle") was accurate
   about the answer, and wrong about where the fault was.
3. **Repeats separate signal from noise.** One run produced two "bugs": one real, one a test bug. Three runs exposed
   three flaky rubrics as well.
4. **Every change needs evidence.** Keep the fixes a real failure justifies, and revert the rest.

Run 3, after the test fixes, the revert and the résumé fix, with 3 repeats per test against staging: **judge
calibration 14 of 14, eireford 11 of 11, wedocompute 9 of 9, lesspane 19 of 19. No failures and no flaky tests
in 117 graded runs.** The booking suite also passed locally (2 runs each): the assistant never books without a
"yes", and books with one.

Later the same day, a second tool found a gap these suites missed. DeepEval evals inside wedocompute-com's backend
(`backend/evals/`, wedocompute-com #20) check every fact in an answer against the brief the model was given. Asked
"Who has Eire worked for?", the assistant said "Eire's past employers **and clients** include Remotely Video, DF
Studio…" in 3 of 4 runs. The suite here had a test for invented clients, but its rubric allowed past employers to
be mentioned, so it never asked whether they were called clients. The fix (wedocompute-com #21) is one rule in the
instructions. The finding became a test here, `past employers → employers, never clients`, with a regex for the
grouped wording and a rubric with three calibration examples. Against staging, without the fix, it failed 1 of 4
runs; both the regex and the judge caught it. Against a local backend with the fix it passed 4 of 4, and so did the
other 10 tests. The lesson: **a second method looks for different failures.** Each check in a suite covers what its
author thought to ask.

## 10. The tool landscape (November 2026)

No single tool wins. Choose by job.

| Tool | What it is | Best for |
| --- | --- | --- |
| **promptfoo** (used here) | Open-source CLI with YAML configs, many providers including raw HTTP, LLM-as-judge assertions, red teaming, CI gating | Black-box tests of deployed endpoints across stacks; CI gates; red teaming. Acquired by OpenAI (announced March 2026), which says the MIT project continues; that's a vendor risk, and keeping suites in plain YAML keeps them portable |
| **DeepEval** (used in wedocompute-com's backend) | Pytest-style framework with many built-in metrics | Python codebases that want evals inside their test suite. Calibrate its built-in metrics before trusting them: here its faithfulness metric passed an invented price |
| **Inspect AI** (UK AI Security Institute) | Python framework for agent and capability evals, with sandboxes | Agentic tasks, tool use and safety research |
| **Ragas** | Metrics for retrieval-augmented generation | Grading retrieval quality and grounding |
| **Vertex AI Gen AI evaluation service** | Google's managed evals: adaptive rubrics, agent trajectory and final-response metrics, results in Vertex AI Experiments | These projects are on Vertex, so it's the natural next step for trajectory evals and managed rubric grading |
| **Langfuse** (open source, self-hostable) | Tracing, prompt management, datasets, online evaluators | Owning production traces and scoring sampled conversations |
| **Braintrust, LangSmith, Arize Phoenix** | Commercial or open platforms combining tracing, experiments and evals | Teams that want one managed platform |
| **OpenTelemetry GenAI semantic conventions** | The emerging standard names for LLM spans (`gen_ai.request.model`, `gen_ai.usage.input_tokens`, `invoke_agent`, `execute_tool`) | Vendor-neutral tracing; still "Development" status, and moved to its own repository in June 2026, so pin versions |

## 11. Using this in your career

What this project shows:

- **The method:** evaluation design for non-deterministic systems, with layered checks, calibrated LLM judges,
  statistical pass criteria, metamorphic and oracle testing, and side-effect safety.
- **The tooling:** promptfoo, Vertex AI and Gemini, and a working knowledge of the 2026 landscape and its
  trade-offs.
- **Results:** it found two real defects in production assistants on its first run, and the fixes are verified.
- **Background:** years of test automation (SDET at Palo Alto Software, test work at DF Studio and the University
  of Oregon) carried into AI quality. It's a natural fit for the "Silent Observer" test-suite service on
  wedocompute.com.

Questions you can now answer in an interview:

- How do you test something that gives a different answer every time?
- When would you use an LLM judge, and how do you know you can trust it?
- How many repeated runs are enough, and what does 3 out of 3 really tell you?
- How do you stop evals from causing side effects?
- What would you monitor for an AI feature in production?

Ways to go deeper, roughly in order:

1. Run `promptfoo redteam` against staging and triage what it finds.
2. Add trajectory evals for the lesspane tools (production plan, phase 3).
3. Schedule nightly evals against production with alerting (phase 2).
4. Grade a sample of real conversations (phase 4), and measure your judge against your own labels on real data.

## Sources

- [7 Best LLM Evaluation Platforms Compared (2026), Arize](https://arize.com/resources/llm-and-agent-evaluation-platforms/)
- [Best AI agent evaluation tools (2026): offline, CI and production evals compared](https://dev.to/shubhampalriwala/best-ai-agent-evaluation-tools-2026-offline-ci-and-production-evals-compared-2394)
- [LLM Evaluation Tools: The Complete Comparison Guide (2026)](https://inference.net/content/llm-evaluation-tools-comparison/)
- [OpenAI to acquire Promptfoo](https://openai.com/index/openai-to-acquire-promptfoo/) and [SiliconANGLE coverage](https://siliconangle.com/2026/03/09/openai-acquire-promptfoo-expand-ai-application-testing-capabilities/)
- [promptfoo: HTTP provider](https://www.promptfoo.dev/docs/providers/http/), [llm-rubric](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/), [Google Vertex provider](https://www.promptfoo.dev/docs/providers/vertex/)
- [Vertex AI Gen AI evaluation service overview](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/evaluation-overview) and [Evaluate Gen AI agents](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/evaluation-agents)
- [Inside the LLM Call: GenAI Observability with OpenTelemetry](https://opentelemetry.io/blog/2026/genai-observability/) and [the conventions are not stable yet](https://dev.to/azena-ai/opentelemetrys-genai-semantic-conventions-are-not-stable-yet-heres-what-actually-shipped-in-2026-3mke)
- [How to Do Non-Deterministic AI System Testing (2026)](https://www.kunalganglani.com/blog/non-deterministic-ai-testing) and [Testing non-deterministic AI outputs](https://www.testmuai.com/blog/testing-non-deterministic-ai-outputs/)
- [The AI Agent Testing Pyramid](https://medium.com/@derekcashmore/the-ai-agent-testing-pyramid-a-practical-framework-for-non-deterministic-systems-276c22feaec8)
