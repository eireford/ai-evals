// A promptfoo provider that talks to a site's chat endpoint exactly as its web page does: black-box, over HTTP.
// One provider covers all three sites, whose APIs differ:
//
//   eireford     POST /chat/message  {message}                 → {response} | {error}
//   wedocompute  POST /api/chat      {message}                 → {reply}    | {detail}
//   lesspane     POST /api/chat      {messages: [{role, text}]} → {reply}    | {error}
//
// Only lesspane keeps a conversation, so multi-turn tests pass earlier turns in `vars.history`.
// Each site allows 10 chat requests per minute per IP, so calls to one site are spaced out, and a 429 is retried
// after its Retry-After.

import { setTimeout as sleep } from 'node:timers/promises';

/** Where each site's chat lives, per target. `local` is the dev server, the only place with no side effects. */
export const SITES = {
	eireford: {
		path: '/chat/message',
		targets: {
			local: 'http://localhost:8080',
			staging: 'https://eireford-staging-355902301061.us-west1.run.app',
			production: 'https://eireford.com'
		},
		body: (prompt) => ({ message: prompt }),
		reply: (json) => json.response,
		problem: (json) => json.error
	},
	wedocompute: {
		path: '/api/chat',
		targets: {
			local: 'http://localhost:8000',
			staging: 'https://wedocompute-backend-staging-1020779261528.us-west1.run.app',
			production: 'https://api.wedocompute.com'
		},
		body: (prompt) => ({ message: prompt }),
		reply: (json) => json.reply,
		problem: (json) => (typeof json.detail === 'string' ? json.detail : JSON.stringify(json.detail))
	},
	lesspane: {
		path: '/api/chat',
		targets: {
			local: 'http://localhost:5173',
			staging: 'https://lesspane.net',
			production: 'https://lesspane.com'
		},
		body: (prompt, history) => ({ messages: [...history, { role: 'user', text: prompt }] }),
		reply: (json) => json.reply,
		problem: (json) => json.error
	}
};

/** Slightly under the sites' limit of 10 a minute. */
const MIN_INTERVAL_MS = Number(process.env.EVAL_MIN_INTERVAL_MS ?? 6500);
const lastCall = new Map();

async function paced(site) {
	const wait = (lastCall.get(site) ?? 0) + MIN_INTERVAL_MS - Date.now();
	if (wait > 0) await sleep(wait);
	lastCall.set(site, Date.now());
}

export default class SiteChatProvider {
	constructor(options = {}) {
		this.site = options.config?.site;
		this.target = process.env.EVAL_TARGET ?? options.config?.target ?? 'staging';
		const spec = SITES[this.site];
		if (!spec) throw new Error(`Unknown site "${this.site}". Use one of: ${Object.keys(SITES).join(', ')}.`);
		const base = process.env.EVAL_BASE_URL ?? spec.targets[this.target];
		if (!base) throw new Error(`Unknown target "${this.target}" for ${this.site}.`);
		this.spec = spec;
		this.url = new URL(spec.path, base).toString();
		this.label = options.label ?? `${this.site} (${this.target})`;
	}

	id() {
		return `site-chat:${this.site}:${this.target}`;
	}

	async callApi(prompt, context) {
		const history = context?.vars?.history ?? [];
		const body = JSON.stringify(this.spec.body(prompt, history));
		for (let attempt = 1; attempt <= 3; attempt++) {
			await paced(this.site);
			const started = Date.now();
			let response;
			try {
				response = await fetch(this.url, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body,
					signal: AbortSignal.timeout(60_000)
				});
			} catch (e) {
				return { error: `Could not reach ${this.url}: ${e.message}` };
			}
			const latencyMs = Date.now() - started;
			const json = await response.json().catch(() => ({}));
			if (response.status === 429 && attempt < 3) {
				await sleep(Number(response.headers.get('retry-after') ?? 60) * 1000);
				continue;
			}
			if (!response.ok) {
				// Errors stay errors: an eval of a 503 must fail, never grade the error text as an answer.
				return { error: `HTTP ${response.status}: ${this.spec.problem(json) ?? 'no message'}`, latencyMs };
			}
			const output = this.spec.reply(json);
			if (typeof output !== 'string' || !output.trim()) {
				return { error: `HTTP ${response.status} but no reply in ${JSON.stringify(json).slice(0, 200)}`, latencyMs };
			}
			return { output, latencyMs, metadata: { target: this.target, url: this.url } };
		}
		return { error: 'Still rate limited after 3 attempts.' };
	}
}
