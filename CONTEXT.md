# pi-glm-usage

A pi coding agent extension that surfaces GLM Coding Plan usage in the agent UI while a Zhipu plan provider is active.

## Language

**Plan provider**:
A pi provider backed by a GLM Coding Plan subscription (`zai-coding-cn` for China, `zai` for global).
_Avoid_: account, endpoint

**Quota window**:
A rolling token allowance reported as `TOKENS_LIMIT`; unit 3 is the 5-hour window, unit 6 the weekly window. Both providers report both units.
_Avoid_: rate limit, 5h limit

**MCP quota**:
The usage allowance reported as `TIME_LIMIT` (unit 5), metered in calls (`usage`/`currentValue`/`remaining`); shared across both endpoints' subscription.
_Avoid_: monthly limit

**Weekly quota**:
The 7-day token allowance reported as `TOKENS_LIMIT` with unit 6 on global plans; resets on a fixed weekday.
_Avoid_: week limit, 7d limit

**Reset time**:
The `nextResetTime` epoch-millisecond timestamp attached to each limit; displayed as a countdown.
_Avoid_: expiry, deadline

**Plan level**:
The subscription tier (`lite`/`pro`/`max`) reported alongside the limits.
_Avoid_: tier, plan type

**Snapshot**:
One successful reading of the usage API: quota-window percentage, MCP percentage (optional), and window reset time (optional).
_Avoid_: cache entry, reading

**Stale**:
A snapshot older than its expected refresh interval, marked with `~` in the footer rather than discarded.
_Avoid_: expired, invalid
