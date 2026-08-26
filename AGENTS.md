# AGENTS.md — pi-glm-usage

A [pi coding agent](https://github.com/earendil-works/pi-mono) extension that surfaces GLM Coding Plan (China & Global) quota usage in the footer, with a detailed `/glm-usage` report command.

## Project standards

- **No personal information in any file.** No real names, email addresses, account handles, or API keys — in code, docs, ADRs, commit messages, or fixtures. Package coordinates (`@zhaoji-wang/pi-glm-usage`, the GitHub repo URL) are the only identity allowed, and only where functionally required (README install commands, `package.json` `repository`).
- **English-only** for all shipped text: code comments, commit messages, README, UI strings (see ADR-0001).
- **Zero runtime dependencies.** Node built-ins (`fetch`, `node:fs`) only. Pi core packages are `peerDependencies`, never bundled.
- **Single extension file** (`extensions/glm-usage.ts`) with pure helpers exported as named exports from the same file — pi's loader may treat extra files under `extensions/` as extensions.
- **Undocumented API**: all Zhipu monitor-endpoint access stays behind one small API boundary; failures degrade quietly (footer keeps stale value with `~`), never throw into the host.
- **Timezone rules** (ADR-0002): request window params are formatted in Asia/Shanghai; user-facing reset times render in the user's **local** timezone. Two different zones, two different purposes — keep the comment.
- **MIT license** — keep the `LICENSE` file and the `license` field in sync.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles with default names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.
