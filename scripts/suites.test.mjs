// Tests for the tests. Evals are code, and a broken eval reports a broken assistant.
//
// This catches the bug that wasted a fix on 2026-11-20: in YAML's flow style, `{ question: Can you come on a
// Sunday, and can I pay with Zelle? }` silently becomes {question: "Can you come on a Sunday", "and can I pay with
// Zelle?": null}, so the assistant was asked half the question and "failed" for not answering the other half.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const suitesDir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'suites');

/** Every inline test in every suite file (YAML suites, test-list YAML files and the generated price tests). */
async function allTests() {
	const out = [];
	for (const file of readdirSync(suitesDir)) {
		const full = path.join(suitesDir, file);
		if (file.endsWith('.mjs')) {
			for (const t of (await import(full)).default) out.push({ file, t });
		} else if (file.endsWith('.yaml')) {
			const doc = load(readFileSync(full, 'utf8'));
			const tests = Array.isArray(doc) ? doc : (doc.tests ?? []);
			for (const t of tests) if (typeof t === 'object') out.push({ file, t });
		}
	}
	return out;
}

test('every test has a description, metadata and at least one assertion', async () => {
	for (const { file, t } of await allTests()) {
		assert.ok(t.description, `${file}: a test without a description`);
		assert.ok(t.metadata, `${file}: "${t.description}" has no metadata (category, critical)`);
		assert.ok(Array.isArray(t.assert) && t.assert.length, `${file}: "${t.description}" has no assertions`);
	}
});

test('no variable is null, and every question or answer is a complete string', async () => {
	for (const { file, t } of await allTests()) {
		for (const [key, value] of Object.entries(t.vars ?? {})) {
			assert.notEqual(value, null, `${file}: "${t.description}" has a null var "${key}" (unquoted comma in YAML?)`);
		}
		const text = t.vars?.question ?? t.vars?.answer;
		assert.equal(typeof text, 'string', `${file}: "${t.description}" has no question or answer`);
		assert.ok(text.trim().length > 3, `${file}: "${t.description}" has an empty question`);
	}
});

test('descriptions are unique, because repeated runs are grouped by description', async () => {
	const seen = new Map();
	for (const { file, t } of await allTests()) {
		assert.ok(!seen.has(t.description), `"${t.description}" is in both ${seen.get(t.description)} and ${file}`);
		seen.set(t.description, file);
	}
});

test('every llm-rubric states what fails ("Fails if …", "Gives no price", "Does not …")', async () => {
	for (const { file, t } of await allTests()) {
		for (const a of t.assert ?? []) {
			if (a.type !== 'llm-rubric') continue;
			const rubric = String(a.value);
			assert.ok(
				/\bfails?\b|\bdoes not\b|\bdoesn't\b|\bno\b|\bnothing\b|\bnever\b/i.test(rubric),
				`${file}: "${t.description}" rubric has no failure condition: ${rubric.slice(0, 80)}…`
			);
		}
	}
});
