// Turning repeated, non-deterministic runs into a pass/fail decision.
//
// An LLM can answer the same question differently each time, so one run of a test tells you little. Each test runs
// N times (--repeat), and the verdict looks at all N:
//
//   critical tests (facts, safety, prices) must pass every run. One failure in N is a real bug that will reach
//     some customers, not noise to average away.
//   other tests (judged quality) must pass at least `minPassRate` of runs (default 2/3).
//
// A test that passes some runs and fails others is "flaky" and is reported as such, because flakiness itself is
// the finding: the assistant is unreliable on that question.
//
// With small N the observed pass rate is a rough estimate, so the report also shows a 95% Wilson interval: with 3
// out of 3 passes, the true pass rate could still be as low as about 44%. More repeats narrow it.

/** Wilson score interval for a binomial proportion (95% by default). Returns [low, high]. */
export function wilson(passes, total, z = 1.96) {
	if (total === 0) return [0, 1];
	const p = passes / total;
	const denom = 1 + (z * z) / total;
	const centre = (p + (z * z) / (2 * total)) / denom;
	const margin = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom;
	return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

/**
 * Groups promptfoo results by test and decides each one.
 * @param {Array<{testCase: {description?: string, metadata?: object}, success: boolean, error?: string,
 *   gradingResult?: {reason?: string}, response?: {output?: string}}>} results
 */
export function summarize(results, { minPassRate = 2 / 3 } = {}) {
	const byTest = new Map();
	for (const r of results) {
		const key = r.testCase?.description ?? r.description ?? '(no description)';
		if (!byTest.has(key)) byTest.set(key, { name: key, metadata: r.testCase?.metadata ?? {}, runs: [] });
		byTest.get(key).runs.push({
			pass: Boolean(r.success),
			error: r.error ?? null,
			reason: r.gradingResult?.reason ?? r.error ?? '',
			output: r.response?.output ?? ''
		});
	}
	const tests = [...byTest.values()].map((t) => {
		const passes = t.runs.filter((r) => r.pass).length;
		const total = t.runs.length;
		const critical = t.metadata.critical !== false;
		const required = critical ? 1 : (t.metadata.minPassRate ?? minPassRate);
		const rate = total ? passes / total : 0;
		const verdict = rate >= required - 1e-9 ? 'pass' : 'fail';
		return {
			...t,
			passes,
			total,
			rate,
			required,
			critical,
			interval: wilson(passes, total),
			flaky: passes > 0 && passes < total,
			errors: t.runs.filter((r) => r.error).length,
			verdict
		};
	});
	return {
		tests,
		passed: tests.filter((t) => t.verdict === 'pass').length,
		failed: tests.filter((t) => t.verdict === 'fail').length,
		flaky: tests.filter((t) => t.flaky).length
	};
}

const pct = (x) => `${Math.round(x * 100)}%`;

/** A plain-text report, one line per test, failures first with the judge's or assertion's reason. */
export function formatReport(title, summary) {
	const lines = [`\n${title}: ${summary.passed} passed, ${summary.failed} failed, ${summary.flaky} flaky`];
	const order = [...summary.tests].sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === 'fail' ? -1 : 1));
	for (const t of order) {
		const mark = t.verdict === 'pass' ? (t.flaky ? '~' : '✓') : '✗';
		const [lo, hi] = t.interval;
		lines.push(
			`  ${mark} ${t.passes}/${t.total} (95% CI ${pct(lo)}–${pct(hi)}, needs ${pct(t.required)}${t.critical ? ', critical' : ''})  ${t.name}`
		);
		if (t.verdict === 'fail' || t.flaky) {
			const why = t.runs.find((r) => !r.pass);
			if (why) lines.push(`      ↳ ${why.reason.replace(/\s+/g, ' ').slice(0, 300)}`);
		}
	}
	return lines.join('\n');
}
