# AGENTS.md — pi-glm-usage

A [pi coding agent](https://github.com/earendil-works/pi-mono) extension that surfaces GLM Coding Plan (China & Global) quota usage in the footer, with a detailed `/glm-usage` report command.

## Project standards

- **No personal information in any file.** No real names, email addresses, account handles, or API keys — in code, docs, ADRs, commit messages, or fixtures. Package coordinates (`@zhaoji-wang/pi-glm-usage`, the GitHub repo URL) are the only identity allowed, and only where functionally required (README install commands, `package.json` `repository`). Git history is part of "any file": set the repo-local `user.name`/`user.email` to the neutral identity **before the first commit**; rewriting history after the fact cost a full filter-branch + force-push cycle.
- **Shipped text is English** (ADR-0001): code comments, commit messages, README.md. `README.zh-CN.md` mirrors it in idiomatic Chinese — same content, natural phrasing, never word-for-word translation; both comparison tables and both language versions change together, with no notes about the sync process in reader-facing text.
- **UI language for the extension itself** follows `PI_GLM_USAGE_LANG`, then locale, then English; `--json` keys stay English (see the message catalog in `extensions/glm-usage.ts`).
- **Zero runtime dependencies.** Node built-ins (`fetch`, `node:fs`) only. Pi core packages are `peerDependencies`, never bundled. A runtime **value** import from any `@earendil-works/pi-*` package breaks installed packages (`--omit=dev` installs): the report overlay renders plain text lines and compares raw key bytes (`\r`, `\n`, `\x1b`) instead of importing `pi-tui` components.
- **Single extension file** (`extensions/glm-usage.ts`) with pure helpers exported as named exports from the same file — pi's loader may treat extra files under `extensions/` as extensions. The i18n message catalog lives in this file for that reason.
- **Undocumented API**: all Zhipu monitor-endpoint access stays behind one small API boundary; failures degrade quietly (footer keeps stale value with `~`), never throw into the host.
- **Timezone rules** (ADR-0002): request window params are formatted in Asia/Shanghai; user-facing reset times render in the user's **local** timezone. Two different zones, two different purposes — keep the comment.
- **MIT license** — keep the `LICENSE` file and the `license` field in sync.

## Hard-won implementation notes

Each item below cost a real failure in this repo's history. None of them is guesswork.

### Pi host behavior the fake-pi tests cannot catch

- Activation must be seeded in `session_start` from `event.model ?? ctx.model`. `model_select` fires only on `/model`, cycling, or session restore — a plain startup with a GLM default model never activates anything (0.1.0 shipped with this bug; found only by cross-review).
- Mode gating reads `ctx.mode` / `ctx.hasUI` per event. `process.stdout.isTTY` is wrong twice over: `pi -p` attached to a terminal still has a TTY, and RPC mode has a UI without a TTY. `console.log` in non-print modes corrupts the RPC protocol stream.
- `ctx.ui.setStatus(key, undefined)` clears the slot; the empty string does not.
- Before any release, install the packed tarball into a throwaway project and run it under real `pi` once. The S1 seam exercises a fake host; it validated our assumptions about pi rather than pi itself — both 0.1.0 blockers (startup activation, pi-tui import) were invisible to 79 passing tests.

### Toolchain

- pnpm 11 build policy lives in `pnpm-workspace.yaml` under `allowBuilds` with `true`/`false` values. The v10 names (`onlyBuiltDependencies` etc.) are ignored with a deprecation warning that looks like a build error; `block` is not a valid value.
- CI installs run `pnpm install` (frozen-lockfile is automatic when pnpm detects CI). Editing `package.json` dependencies requires regenerating the lockfile in the same commit — frozen-lockfile rejects the drift, and merging mid-drift breaks main.
- `gh pr checks` emits `pass`/`fail`/`pending` as the status word; `gh run view` emits `success`/`failure` as conclusions. A polling loop written for one vocabulary silently spins forever against the other. Verify the actual output vocabulary before writing an exit condition.

### npm publishing (this repo's exact path)

- npm answers an unauthenticated scoped PUT with **404**, not 401. A 404 on publish means "no credentials reached the registry", not "package missing". `NODE_AUTH_TOKEN` is a setup-node convention — pnpm does not read it, and `pnpm/setup` writes no `.npmrc`; publishing from that environment is anonymous (0.1.0's first failure).
- OIDC trusted publishing works only in the `actions/setup-node` + `registry-url` shape: with `pnpm/setup`'s environment, npm CLI falls back to credential auth and fails `ENEEDAUTH` even with `id-token: write` granted (0.1.1's first failure). pnpm remains fine for install/test steps.
- `repository.url` must use the `git+https://` form npm normalizes to; the bare `https://` form gets silently rewritten at publish time and breaks the OIDC exact-match check.
- Provenance comes free with OIDC from public repos; `--provenance` is only needed for token-based publishes.

## Writing rules (enforced by maintainer review)

Reader-facing text contains only reader-facing facts. No maintainer meta-notes ("kept in sync with…", "both files updated together"), no process narration. The zh README is written as Chinese a Chinese engineer would write, not translated: calques banned so far include “克制的客户端” (polite client), “重新武装” (re-arm), “收紧” (tighten), “脚本消费者” (script consumers), "this is why" sentence tails ("…原因在这里"→ state the cause directly). English technical terms stay only when they are the term of art (token, scope, footer); everything else has a Chinese equivalent in use.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles with default names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.
