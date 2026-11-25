// A promptfoo provider that plays someone's personal AI assistant ordering from LessPane on its own, the way an
// outside agent would: a real model (Gemini on Vertex AI) with nothing but LessPane's MCP server
// (lesspane/docs/agent-ordering-plan.md). The prompt is what the person tells their assistant.
//
// The output is JSON, so assertions can check what the agent did, not only what it said:
//   {"text": the assistant's final answer, "calls": [{"name", "args", "error", "result"}, ...]}
//
// request_booking creates a booking, so this provider only runs against a local LessPane (EVAL_TARGET=local).

import { GoogleGenAI } from '@google/genai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SITES } from './site-chat.mjs';

const MAX_ROUNDS = 8;

/** LessPane allows 20 agent requests a minute per IP; one MCP request every 3.2 s stays under it. */
const MIN_INTERVAL_MS = Number(process.env.EVAL_MCP_INTERVAL_MS ?? 3200);
let last = 0;
const pacedFetch = async (url, init) => {
	const wait = last + MIN_INTERVAL_MS - Date.now();
	last = Date.now() + Math.max(wait, 0);
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	return fetch(url, init);
};

/** "Tuesday, 2026-11-24", in the business's time zone, so "next Tuesday" means the same to the agent and the test. */
export function today(now = new Date()) {
	const tz = 'America/New_York';
	const iso = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
	const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(now);
	return { iso, weekday };
}

let genai = null;

export default class McpAgentProvider {
	constructor(options = {}) {
		this.target = process.env.EVAL_TARGET ?? options.config?.target ?? 'local';
		if (this.target !== 'local') throw new Error('mcp-agent books, so it only runs with EVAL_TARGET=local.');
		const base = process.env.EVAL_BASE_URL ?? SITES.lesspane.targets.local;
		this.mcpUrl = new URL('/mcp', base);
		this.model = options.config?.model ?? 'gemini-3.5-flash';
		this.project = process.env.EVAL_GCP_PROJECT ?? options.config?.project ?? 'eireford-com';
		this.label = options.label ?? `mcp-agent (${this.model})`;
	}

	id() {
		return `mcp-agent:${this.model}:${this.target}`;
	}

	/**
	 * Cancels what the agent booked, after its answer is recorded, so repeated runs start clean (LessPane allows
	 * three open requests per email) and the local data holds no stray requests.
	 */
	async cleanUp(client, calls) {
		for (const c of calls) {
			const token = !c.error && c.name === 'request_booking' ? c.result?.booking_token : null;
			if (token) await client.callTool({ name: 'cancel_booking', arguments: { booking_token: token } }).catch(() => {});
		}
	}

	async callApi(prompt) {
		genai ??= new GoogleGenAI({ vertexai: true, project: this.project, location: 'global' });
		const client = new Client({ name: 'ai-evals-mcp-agent', version: '1.0.0' });
		const calls = [];
		try {
			await client.connect(new StreamableHTTPClientTransport(this.mcpUrl, { fetch: pacedFetch }));
			const { tools } = await client.listTools();
			const { iso, weekday } = today();
			const system = [
				'You are the personal AI assistant of the person writing to you. You act for them.',
				`Today is ${weekday}, ${iso}.`,
				'You can use the tools of LessPane, a window cleaning business, which you reach over MCP. Its instructions:',
				client.getInstructions() ?? '(none)',
				'When you call request_booking, set agent to "Gemini, ai-evals". Only state facts and prices the tools gave you.'
			].join('\n\n');
			const functionDeclarations = tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.inputSchema }));
			const contents = [{ role: 'user', parts: [{ text: prompt }] }];

			for (let round = 0; round < MAX_ROUNDS; round++) {
				const response = await genai.models.generateContent({
					model: this.model,
					contents,
					config: { systemInstruction: system, tools: [{ functionDeclarations }], temperature: 0 }
				});
				const fnCalls = response.functionCalls ?? [];
				if (!fnCalls.length) {
					await this.cleanUp(client, calls);
					return { output: JSON.stringify({ text: response.text?.trim() ?? '', calls }) };
				}
				contents.push(response.candidates?.[0]?.content ?? { role: 'model', parts: fnCalls.map((functionCall) => ({ functionCall })) });
				const parts = [];
				for (const call of fnCalls) {
					const r = await client.callTool({ name: call.name, arguments: call.args ?? {} });
					const result = r.structuredContent ?? { text: r.content?.map((c) => c.text).join('\n') };
					calls.push({ name: call.name, args: call.args ?? {}, error: !!r.isError, result });
					parts.push({ functionResponse: { id: call.id, name: call.name, response: result } });
				}
				contents.push({ role: 'user', parts });
			}
			await this.cleanUp(client, calls);
			return { error: `The agent was still calling tools after ${MAX_ROUNDS} rounds.`, output: JSON.stringify({ text: '', calls }) };
		} catch (e) {
			return { error: `mcp-agent failed: ${e.message}` };
		} finally {
			await client.close().catch(() => {});
		}
	}
}
