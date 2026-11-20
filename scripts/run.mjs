#!/usr/bin/env node
// Runs eval suites with repeats and decides pass/fail from the repeated results (scripts/stats.mjs).
//
//   npm run eval                       all suites against staging (the default target)
//   npm run eval -- lesspane           one suite
//   EVAL_TARGET=production npm run eval -- eireford
//   EVAL_TARGET=local npm run eval -- lesspane-local     booking tests, needs lesspane's dev server
//   EVAL_REPEAT=5 npm run eval -- judge
//
// Results: results/<suite>-<target>-<time>.json (promptfoo's full output, viewable with `npm run view`) and a
// summary per suite on the console. The exit code is 1 if any test fails its required pass rate.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReport, summarize } from './stats.mjs';
import { PACKAGES, price } from '../fixtures/lesspane-pricing.mjs';
import { SITES } from '../providers/site-chat.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SUITES = {
	judge: 'suites/judge-calibration.yaml',
	eireford: 'suites/eireford.yaml',
	wedocompute: 'suites/wedocompute.yaml',
	lesspane: 'suites/lesspane.yaml',
	'lesspane-local': 'suites/lesspane-local.yaml'
};
const target = process.env.EVAL_TARGET ?? 'staging';
const repeat = Number(process.env.EVAL_REPEAT ?? 3);
const asked = process.argv.slice(2);
// Booking tests only ever run locally; everything else runs against the chosen target. The judge goes first:
// if it can't be trusted, the other verdicts can't either.
const chosen = asked.length
	? asked
	: target === 'local'
		? ['judge', 'lesspane-local']
		: ['judge', 'eireford', 'wedocompute', 'lesspane'];

for (const name of chosen) {
	if (!SUITES[name]) {
		console.error(`Unknown suite "${name}". Choose from: ${Object.keys(SUITES).join(', ')}.`);
		process.exit(2);
	}
	if (name === 'lesspane-local' && target !== 'local') {
		console.error('lesspane-local creates bookings, so it only runs with EVAL_TARGET=local.');
		process.exit(2);
	}
}

/** The oracle is a copy of LessPane's prices; stop before grading against a stale copy. */
async function checkLesspaneOracle() {
	const base = process.env.EVAL_BASE_URL ?? SITES.lesspane.targets[target];
	const html = await (await fetch(base)).text();
	const problems = [];
	for (const [name, job] of Object.entries(PACKAGES)) {
		const m = html.match(new RegExp(`aria-label="${name}:[^"]*\\$([\\d,]+)"`));
		const live = m ? Number(m[1].replace(/,/g, '')) : null;
		if (live !== price(job)) problems.push(`${name}: site says ${live ?? '?'}, oracle says ${price(job)}`);
	}
	if (problems.length) {
		throw new Error(
			`The pricing oracle (fixtures/lesspane-pricing.mjs) no longer matches ${base}:\n  ${problems.join('\n  ')}\n` +
				'Update the oracle to the new prices, then rerun.'
		);
	}
	console.log(`Pricing oracle matches ${base}.`);
}

mkdirSync(path.join(root, 'results'), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
let failed = 0;
const summaries = [];

for (const name of chosen) {
	if (name === 'lesspane') await checkLesspaneOracle();
	const out = path.join('results', `${name}-${name === 'judge' ? 'fixed' : target}-${stamp}.json`);
	console.log(`\n▶ ${name} (${name === 'judge' ? 'fixed answers' : target}), ${repeat} run(s) per test`);
	const result = spawnSync(
		'npx',
		['promptfoo', 'eval', '-c', SUITES[name], '--repeat', String(repeat), '-j', name === 'judge' ? '4' : '1', '--no-cache', '--no-table', '-o', out],
		{
			cwd: root,
			stdio: ['ignore', 'inherit', 'inherit'],
			env: { PROMPTFOO_DISABLE_TELEMETRY: '1', PROMPTFOO_DISABLE_UPDATE: '1', ...process.env, EVAL_TARGET: target }
		}
	);
	let results;
	try {
		results = JSON.parse(readFileSync(path.join(root, out), 'utf8')).results.results;
	} catch {
		console.error(`No results from ${name} (promptfoo exited ${result.status}).`);
		failed++;
		continue;
	}
	const summary = summarize(results);
	summaries.push({ suite: name, target: name === 'judge' ? 'fixed' : target, repeat, ...summary });
	console.log(formatReport(name, summary));
	failed += summary.failed;
}

writeFileSync(
	path.join(root, 'results', `summary-${target}-${stamp}.json`),
	JSON.stringify({ target, repeat, at: new Date().toISOString(), suites: summaries }, null, 2)
);
console.log(failed ? `\n${failed} test(s) failed.` : '\nAll tests passed.');
process.exit(failed ? 1 : 0);
