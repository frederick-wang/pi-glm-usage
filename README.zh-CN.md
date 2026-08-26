# pi-glm-usage

**[English](./README.md)** | 简体中文

> **非官方项目。** 与智谱 AI / Z.ai 无关联。数据来自 GLM Coding Plan 的用量监控端点——
> 该端点未经官方文档化（实现参考了智谱官方工具中的调用方式），可能随时变更或失效。

在 [pi coding agent](https://github.com/earendil-works/pi-mono) 底部状态栏显示 GLM Coding Plan
（国内版 / 国际版）配额用量，提供阈值提醒和 `/glm-usage` 用量报告。

```
GLM 5h 34%↻1h40m·W 2%
```

## 用法

### 状态栏

活动模型的供应商为 `zai-coding-cn` 或 `zai` 时显示；切换到其他供应商即清除。

```
GLM 5h 34%↻2h 40m·W 2%
```

| 元素 | 含义 |
| --- | --- |
| `5h` / `W` / `M` | 5 小时滚动 token 窗口 / 周配额 / MCP 月度配额；最多显示两段（先 5h，再 W 或 M） |
| `34%` | 该窗口已用百分比（整数，0–100） |
| `↻2h 40m` | 距下一次重置的剩余时间（取最先重置的窗口），每 30 秒在本地重算，不发网络请求；7 天内显示星期和时间（`↻Sat 05:00`），更远显示日期（`↻Sep06`） |
| `~` | 显示值为过期数据：上次刷新失败，保留旧值 |
| 颜色 | 绿 < 50%，黄 50–79%，红 ≥ 80% |

### 阈值提醒

用量越过 80% 或 95% 时提醒一次，同一配额窗口、同一档位不重复提醒：

```
GLM 5h 配额已用 85%（越过 80%）
```

用量在阈值附近来回波动时不会重复提示；用量回落 20 个百分点以上后，再次越过阈值会重新提示。
提醒状态写入会话文件，重启后仍生效。

### `/glm-usage`

打开覆盖层，显示全部配额段，以及近 24 小时按模型、按工具的用量明细。
明细端点已在国内版套餐上验证；国际版端点未验证，请求失败时报告只显示配额部分：

```
GLM Coding Plan — max
  5h window   34% used   resets in 2h 40m
  Weekly      2% used   resets in Sat 05:00
  MCP         1% used   resets in Sep06

Model usage (last 24h):
  GLM-5.3  31436935
  GLM-4.7  296701
```

（示例取自英文界面。中文界面对应显示为：5小时窗口、周配额、"2h 40m 后重置"等，见下文"界面语言"。）

`/glm-usage --json` 输出原始合并数据（配额快照、查询窗口、明细数组），
仅支持 TUI 与 print 模式。

### 刷新行为

激活时和执行 `/glm-usage` 时各请求一次；每轮对话结束后，每 180 秒最多请求一次
（任一 token 窗口用量 ≥ 80% 后缩短为 60 秒）。收到 429 或 5xx 时按 `Retry-After` 退避；
连续两次凭据校验失败后熔断，不再请求，直到下次切换模型或执行 `/glm-usage`。
`pi -p` 无头模式不发任何请求。

## 安装

npm（会被 [pi 包目录](https://pi.dev/packages) 收录）：

```bash
pi install npm:@zhaoji-wang/pi-glm-usage
```

或从 git 安装：

```bash
pi install git:github.com/frederick-wang/pi-glm-usage
```

## 密钥配置

密钥解析顺序与 pi 一致：

1. `~/.pi/agent/auth.json`（或 `$PI_CODING_AGENT_DIR/auth.json`）——国内版写入
   `"zai-coding-cn": { "type": "api_key", "key": "…" }`，国际版写入 `"zai": { … }`；
2. 否则读取环境变量 `ZAI_CODING_CN_API_KEY` / `ZAI_API_KEY`。

两者同时存在且取值不同时，警告一次，然后使用 auth.json 中的 key（与 pi 的优先级一致）。
auth.json 存在但无法解析时，给出明确错误，不会静默改用环境变量里其他账号的凭据。

## 界面语言

状态栏本身为语言中立的符号。提示、报告与错误指引遵循 `PI_GLM_USAGE_LANG`（`zh` 或 `en`）；
未设置时读取进程 locale——用户显式设置的中文 locale 视为需要中文；再否则为英文。
`--json` 的输出字段固定为英文，供脚本读取。

## 为什么有这个包

npm 上已存在同名的无 scope 包 `pi-glm-usage`。对比（截至 2026-08-27，
本包 0.1.1，现有包 0.1.2；内容与英文版表格一致）：

| | @zhaoji-wang/pi-glm-usage | 无 scope 的 pi-glm-usage |
| --- | --- | --- |
| 国内版端点（open.bigmodel.cn） | 支持 | 不支持 |
| 国际版端点（api.z.ai） | 支持 | 支持 |
| 切换供应商时清除状态栏 | 会 | 不会（始终显示） |
| 详细报告命令 | 有（`/glm-usage`、`--json`） | 无 |
| 阈值提醒 | 有 | 无 |
| 退避 / 认证熔断 | 有 | 固定 60 秒重试 |
| 界面消息语言 | 中/英（`PI_GLM_USAGE_LANG` 或 locale；状态栏语言中立） | 仅英文 |
| Key 来源 | auth.json → 环境变量，冲突时警告 | 仅 auth.json 的 `zai` |
| pi peer 依赖 | `@earendil-works/pi-coding-agent` | 改名前的旧包名 |
| 公开的单元测试 | 有 | 无 |

若现有包增加国内版支持，此表将更新或移除（中英文两份同步修改）。

## 隐私

不采集任何数据。API key 只在本地读取，仅用于请求套餐自身的监控端点
（`open.bigmodel.cn` / `api.z.ai`）。提醒去重状态保存在本地 pi 会话文件中。

## 限制

- Node 内置 `fetch` 不读取 `HTTPS_PROXY` 代理设置；如果 pi 本身能通过代理正常使用，而状态栏一直显示过期数据，原因在这里。
- 监控端点没有官方文档。百分比语义在国内版套餐上实测验证过：已用百分比，取值 0–100。
  未知单元代码在状态栏中忽略，在报告中以"单元 N"的形式显示。

## 开发

本仓库使用 pnpm（版本见 `package.json` 的 `packageManager` 字段）。本地开发需要 Node ≥ 23.6（直接运行 TypeScript），CI 使用 Node 24。

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run live-check  # 读取本机密钥并请求一次真实用量
```

MIT 许可证（见 [LICENSE](./LICENSE)）。
