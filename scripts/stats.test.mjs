import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, wilson } from './stats.mjs';
import { price } from '../fixtures/lesspane-pricing.mjs';

const run = (description, success, metadata = {}) => ({ testCase: { description, metadata }, success });

test('wilson interval is wide for small samples and narrows with more', () => {
	const [lo3] = wilson(3, 3);
	const [lo30] = wilson(30, 30);
	assert.ok(lo3 > 0.4 && lo3 < 0.5, `3/3 lower bound ${lo3}`);
	assert.ok(lo30 > 0.88, `30/30 lower bound ${lo30}`);
	assert.deepEqual(wilson(0, 0), [0, 1]);
});

test('critical tests must pass every run; quality tests need 2/3', () => {
	const s = summarize([
		run('fact', true, { critical: true }),
		run('fact', false, { critical: true }),
		run('fact', true, { critical: true }),
		run('style', true, { critical: false }),
		run('style', false, { critical: false }),
		run('style', true, { critical: false })
	]);
	const fact = s.tests.find((t) => t.name === 'fact');
	const style = s.tests.find((t) => t.name === 'style');
	assert.equal(fact.verdict, 'fail');
	assert.equal(fact.flaky, true);
	assert.equal(style.verdict, 'pass');
	assert.equal(s.failed, 1);
	assert.equal(s.flaky, 2);
});

test('tests are critical unless marked otherwise', () => {
	const s = summarize([run('x', true), run('x', false)]);
	assert.equal(s.tests[0].critical, true);
	assert.equal(s.tests[0].verdict, 'fail');
});

test('the pricing oracle matches the prices verified on lesspane.com (v0.5.1+)', () => {
	assert.equal(price({ windows: 12, stories: 1 }), 120); // Cottage: the minimum
	assert.equal(price({ windows: 24, stories: 2 }), 210); // Family home
	assert.equal(price({ windows: 60, stories: 3 }), 630); // Large home
	assert.equal(price({ windows: 24, stories: 2, service: 'interior_exterior' }), 355);
	assert.equal(price({ windows: 18, stories: 2, service: 'interior_exterior' }), 270);
});
