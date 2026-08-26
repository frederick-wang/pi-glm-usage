# pi-glm-usage

English | [简体中文](./README.zh-CN.md)

> **Unofficial.** Not affiliated with Zhipu AI / Z.ai. Reads the GLM Coding Plan
> usage through monitor endpoints observed in Zhipu's official tooling; those
> endpoints are undocumented and may change without notice. This package may
> stop working at any time.

GLM Coding Plan (China & Global) quota usage in the
[pi coding agent](https://github.com/earendil-works/pi-mono) footer,
with threshold alerts and a report command.

```
GLM 5h 34%↻1h40m·W 2%
```

## Install

npm (indexed by the [package gallery](https://pi.dev/packages)):

```bash
pi install npm:@zhaoji-wang/pi-glm-usage
```

Or from git:

```bash
pi install git:github.com/frederick-wang/pi-glm-usage
```

## Usage

### Footer

Appears when the active model's provider is `zai-coding-cn` or `zai`; cleared
on switching to any other provider.

```
GLM 5h 34%↻2h 40m·W 2%
```

| Element | Meaning |
| --- | --- |
| `5h` / `W` / `M` | 5-hour rolling token window / weekly quota / MCP monthly quota; at most two segments are shown (5h first, then W or M) |
| `34%` | used percentage of that window (integer, 0–100) |
| `↻2h 40m` | time until the nearest displayed segment resets, recomputed locally every 30 s without network requests; weekday+time within 7 days (`↻Sat 05:00`), date beyond (`↻Sep06`) |
| `~` | the displayed value is stale: the last refresh failed, the previous number is kept |
| color | green < 50%, yellow 50–79%, red ≥ 80% |

### Threshold alerts

One toast per quota window per tier when usage crosses 80% or 95%:

```
GLM 5h quota at 85% used (crossed 80%)
```

Jitter around a threshold does not re-emit. A drop of 20 points or more
re-arms the tier. Alert state survives restarts (stored in the session file).

### `/glm-usage`

Opens an overlay with every quota segment and per-model / per-tool usage over
the last 24 hours (detail endpoints verified on the China plan; global
degrades to quota-only):

```
GLM Coding Plan — max
  5h window   34% used   resets in 2h 40m
  Weekly      2% used   resets in Sat 05:00
  MCP         1% used   resets in Sep06

Model usage (last 24h):
  GLM-5.3  31436935
  GLM-4.7  296701

Tool usage (last 24h):
```

`/glm-usage --json` prints the raw merged payload (quota snapshot, query
window, detail arrays) instead of the overlay — TUI and print mode only.

### Refresh behavior

Fetches on activation and on `/glm-usage`; after each turn at most every
180 s (60 s once any token window is ≥ 80%). 429/5xx backs off honoring
`Retry-After`. Rejected credentials trip a breaker after two failed rounds
and stop requesting until the next model switch or `/glm-usage`. Headless
runs (`pi -p`) make no requests.

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

An unscoped `pi-glm-usage` already exists on npm. Comparison as of
2026-08-27 (this package 0.1.1, incumbent 0.1.2):

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

MIT license (see [LICENSE](./LICENSE)).
