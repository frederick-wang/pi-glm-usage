# pi-glm-usage

> **Unofficial.** Not affiliated with Zhipu AI / Z.ai. Reads the GLM Coding Plan
> usage through monitor endpoints observed in Zhipu's official tooling; those
> endpoints are undocumented and may change without notice. This package may
> stop working at any time.

GLM Coding Plan (China & Global) quota usage in the
[pi coding agent](https://github.com/earendil-works/pi-mono) footer — with
threshold alerts and a detailed report command.

```
GLM 5h 34%↻1h40m·W 2%
```

## What it does

- **Footer status** while a GLM plan provider (`zai-coding-cn` or `zai`) is
  active: 5-hour window and weekly quota as used percentages, countdown to the
  nearest reset, threshold colors, and a `~` marker when the displayed value is
  stale. Cleared automatically when you switch to another provider.
- **Threshold alerts**: one toast at 80% and 95% per quota window and tier,
  deduplicated by reset-window identity, re-armed by large usage drops, and
  persisted across sessions.
- **`/glm-usage`**: full report in an overlay — plan level, every quota segment
  with reset times, and per-model / per-tool usage over the last 24 hours
  (detail endpoints verified on the China plan; the report degrades to
  quota-only where they are unavailable). `/glm-usage --json` prints the raw
  merged payload.
- **Polite client**: per-provider auth scheme (raw key for CN, Bearer for
  global) with one 401 fallback, auth circuit breaker, 429/5xx backoff
  honoring `Retry-After`, request timeouts, and stale-value fallback instead of
  error spam. Headless (`pi -p`) runs perform no network requests.

## Install

npm (recommended — indexed by the [package gallery](https://pi.dev/packages)):

```bash
pi install npm:@zhaoji-wang/pi-glm-usage
```

Or from git:

```bash
pi install git:github.com/frederick-wang/pi-glm-usage
```

## Key setup

The extension follows pi's own credential precedence:

1. `~/.pi/agent/auth.json` (or `$PI_CODING_AGENT_DIR/auth.json`) —
   `"zai-coding-cn": { "type": "api_key", "key": "…" }` for the China plan,
   `"zai": { … }` for the global plan;
2. otherwise the `ZAI_CODING_CN_API_KEY` / `ZAI_API_KEY` environment variables.

When both exist and differ, a one-time warning is shown and the auth.json key
is used (pi's precedence). A malformed auth.json produces an explicit error
instead of silently reading a different account.

## Why another package

An unscoped `pi-glm-usage` already exists on npm. This package exists because
it covers the China plan (the incumbent hardcodes the global endpoint), gates
on the active provider, and adds a report command, alerts, and backoff.
Factual comparison, as of 2026-08-27 (this package 0.1.0, incumbent 0.1.2):

| | @zhaoji-wang/pi-glm-usage | unscoped pi-glm-usage |
| --- | --- | --- |
| China endpoint (open.bigmodel.cn) | yes | no |
| Global endpoint (api.z.ai) | yes | yes |
| Footer cleared on provider switch | yes | no (always shown) |
| Detailed report command | yes (`/glm-usage`, `--json`) | no |
| Threshold alerts | yes | no |
| Backoff / auth circuit breaker | yes | fixed 60s retries |
| UI message language | en/zh (follows PI_GLM_USAGE_LANG or locale; footer is language-neutral) | English only |
| Key sources | auth.json → env, conflict warning | auth.json `zai` only |
| pi peer dependency | `@earendil-works/pi-coding-agent` | pre-rename package name |
| Published tests | yes | no |

If the incumbent adds China support, this table will be updated or removed.

## Language

The footer is language-neutral. Toasts, the report, and error guidance
follow `PI_GLM_USAGE_LANG` (`zh` or `en`) when set; otherwise the process
locale (a deliberately Chinese shell locale counts as intent); otherwise
English. `--json` output keeps stable English keys for scripts.

## Privacy

No telemetry. The API key is read locally and used only for requests to the
plan's own monitor endpoints (`open.bigmodel.cn` / `api.z.ai`); nothing else
leaves the machine. Alert dedup state is stored in the local pi session file.

## Limitations

- Node's built-in `fetch` ignores `HTTPS_PROXY`; if pi itself works through a
  proxy but the footer shows stale data, this is why.
- The monitor endpoints are undocumented. Percentages are live-verified as
  used% (0–100) on the China plan; unknown quota unit codes are ignored in the
  footer and surfaced generically in the report.

## Development

This repo uses pnpm (see `packageManager` in `package.json`). Node ≥ 23.6 for native TypeScript type stripping; CI runs Node 24.

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run live-check  # resolves the real key and fetches one snapshot
```

MIT license. Contributions welcome.
