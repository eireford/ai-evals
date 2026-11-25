# Agent instructions: ai-evals

Evaluations for the AI assistants on eireford.com, wedocompute.com and lesspane.com. This is part of Eire Ford's job
search (a learning and portfolio project): the plan and the rules shared by every project are in the hub one folder
up (`../AGENTS.md`, `../docs/`). Read `../docs/status.md` first; naming and code rules come from
`../docs/conventions.md`.

## Commands

Node 22.22+ (`. ~/.local/share/env-node22.sh` on Eire's machine; WSL's default Node is older). The judge needs
Google credentials: `gcloud auth application-default login`, or `GOOGLE_APPLICATION_CREDENTIALS` pointing at them.

```bash
npm ci
npm test                                   # statistics and pricing-oracle unit tests, no network
npm run eval                               # judge calibration + all sites on staging, 3 repeats (~25 min)
npm run eval -- lesspane                   # one suite; EVAL_TARGET=staging|production|local; EVAL_REPEAT=N
npm run view                               # promptfoo's viewer for the last results
```

## Rules

- **Never run anything with side effects outside `local`.** Only `suites/lesspane-local.yaml` and
  `suites/lesspane-agent.yaml` book, and `scripts/run.mjs` refuses to run them unless `EVAL_TARGET=local` (the
  `mcp-agent` provider refuses too). Keep every other suite read-only.
- **Respect the sites' limits:** 10 chat requests a minute per IP, and 500 Gemini calls a day per instance. Keep
  `-j 1` and the provider's pacing; don't run evals against production more than needed.
- **Facts come from `../docs/profile.md`** and each site's knowledge files. When a fact changes there, change the
  matching test. LessPane prices: update `fixtures/lesspane-pricing.mjs` (the run stops if it disagrees with the
  live page).
- **Cheapest assertion first:** `icontains`/`regex` before `llm-rubric`. Rubrics must say what fails ("Fails if
  …", "Gives no price"); `npm test` checks. A new rubric gets a near-miss example in
  `suites/judge-calibration.yaml`.
- **A failing eval is a finding, not a nuisance.** Don't loosen a test to make it pass; fix the assistant or explain
  why the test was wrong in the commit message.
- **Results stay local** (`results/` is git-ignored). Don't use `promptfoo share`.
- One task, one branch, one pull request. This repo deploys nothing.
