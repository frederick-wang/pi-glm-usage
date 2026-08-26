/**
 * Test scaffold for pi-glm-usage.
 *
 * System boundaries (fetch, clock, fs, env) are injected; nothing internal is
 * mocked. Extensions are driven through their public surface: the default
 * export factory receives a fake `pi` and we emit the same events the real
 * host would.
 */
export function fakeCtx() {
    const calls = { status: [], notifications: [] };
    const ui = {
        setStatus: (key, text) => {
            calls.status.push({ key, text });
        },
        notify: (message, level) => {
            calls.notifications.push({ message, level });
        },
        theme: { fg: (_role, text) => text },
    };
    return { ctx: { ui }, ui: calls };
}
/** Captures registered event handlers; tests emit events in host order. */
export function fakePi() {
    const handlers = {};
    return {
        handlers,
        on(event, fn) {
            (handlers[event] ??= []).push(fn);
        },
        async emit(event, payload, ctx) {
            for (const fn of handlers[event] ?? [])
                await fn(payload, ctx);
        },
        registeredEvents() {
            return Object.keys(handlers);
        },
    };
}
/** Injectable KeyDeps: auth.json content and env, no real filesystem. */
export function makeKeyDeps(opts) {
    return {
        configDir: "/fake/.pi/agent",
        env: opts.env ?? {},
        readFile(_path) {
            return opts.authRaw ?? null;
        },
    };
}
/** Injectable fetch: serves queued responses, records requests. */
export function fakeFetch(responses) {
    const requests = [];
    let cursor = 0;
    const fn = (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        const next = responses[Math.min(cursor, responses.length - 1)];
        cursor += 1;
        return Promise.resolve(new Response(JSON.stringify(next.body), {
            status: next.status,
            headers: next.headers ?? { "content-type": "application/json" },
        }));
    };
    return { fetch: fn, requests };
}
