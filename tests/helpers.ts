/**
 * Test scaffold for pi-glm-usage.
 *
 * System boundaries (fetch, clock, fs, env) are injected; nothing internal is
 * mocked. Extensions are driven through their public surface: the default
 * export factory receives a fake `pi` and we emit the same events the real
 * host would.
 */

/** Records setStatus/notify calls so tests assert through the public UI seam. */
export interface UiCalls {
	status: Array<{ key: string; text: string }>;
	notifications: Array<{ message: string; level: string }>;
}

export function fakeCtx(): { ctx: Record<string, unknown>; ui: UiCalls } {
	const calls: UiCalls = { status: [], notifications: [] };
	const ui = {
		setStatus: (key: string, text: string) => {
			calls.status.push({ key, text });
		},
		notify: (message: string, level: string) => {
			calls.notifications.push({ message, level });
		},
		theme: { fg: (_role: string, text: string) => text },
	};
	return { ctx: { ui }, ui: calls };
}

/** Captures registered event handlers; tests emit events in host order. */
export interface RegisteredCommand {
	description: string;
	handler: (args: string, ctx: unknown) => Promise<void> | void;
}

export function fakePi() {
	const handlers: Record<string, Array<(event: unknown, ctx: unknown) => unknown>> = {};
	const commands: Record<string, RegisteredCommand> = {};
	return {
		handlers,
		commands,
		on(event: string, fn: (event: unknown, ctx: unknown) => unknown) {
			(handlers[event] ??= []).push(fn);
		},
		registerCommand(name: string, options: RegisteredCommand) {
			commands[name] = options;
		},
		async emit(event: string, payload: unknown, ctx: unknown) {
			for (const fn of handlers[event] ?? []) await fn(payload, ctx);
		},
		async runCommand(name: string, args: string, ctx: unknown) {
			await commands[name]?.handler(args, ctx);
		},
		registeredEvents(): string[] {
			return Object.keys(handlers);
		},
	};
}

/** Injectable KeyDeps: auth.json content and env, no real filesystem. */
export function makeKeyDeps(opts: { authRaw?: string | null; env?: Record<string, string | undefined> }) {
	return {
		configDir: "/fake/.pi/agent",
		env: opts.env ?? {},
		readFile(_path: string): string | null {
			return opts.authRaw ?? null;
		},
	};
}

/** Injectable fetch: serves queued responses, records requests. */
export function fakeFetch(
	responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>,
) {
	const requests: Array<{ url: string; headers: Record<string, string> }> = [];
	let cursor = 0;
	const fn = (url: string | URL, init?: RequestInit) => {
		requests.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
		const next = responses[Math.min(cursor, responses.length - 1)];
		cursor += 1;
		return Promise.resolve(
			new Response(JSON.stringify(next.body), {
				status: next.status,
				headers: next.headers ?? { "content-type": "application/json" },
			}),
		);
	};
	return { fetch: fn as typeof fetch, requests };
}

/** Stub KeybindingsManager: legacy bytes + Kitty CSI-u for the keys we bind. */
export function stubKb(): { matches(data: string, id: string): boolean } {
	const confirm = new Set(["\r", "\n", "\x1b[13u", "\x1bOM"]);
	const cancel = new Set(["\x1b", "\x1b[27u", "\x03", "\x1b[99;5u"]);
	const up = new Set(["\x1b[A", "\x1bOA"]);
	const down = new Set(["\x1b[B", "\x1bOB"]);
	const pageUp = new Set(["\x1b[5~"]);
	const pageDown = new Set(["\x1b[6~"]);
	const home = new Set(["\x1b[H", "\x1b[1~", "\x1bOH"]);
	const end = new Set(["\x1b[F", "\x1b[4~", "\x1bOF"]);
	return {
		matches(data: string, id: string) {
			switch (id) {
				case "tui.select.confirm": return confirm.has(data);
				case "tui.select.cancel": return cancel.has(data);
				case "tui.select.up": return up.has(data);
				case "tui.select.down": return down.has(data);
				case "tui.select.pageUp": return pageUp.has(data);
				case "tui.select.pageDown": return pageDown.has(data);
				case "tui.altScreen.pageUp": return pageUp.has(data);
				case "tui.altScreen.pageDown": return pageDown.has(data);
				case "tui.altScreen.top": return home.has(data);
				case "tui.altScreen.bottom": return end.has(data);
				default: return false;
			}
		},
	};
}
