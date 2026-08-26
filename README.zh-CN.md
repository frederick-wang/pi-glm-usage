# pi-glm-usage

**[English](./README.md)** | 简体中文

> **非官方项目。** 与智谱 AI / Z.ai 无关联。通过智谱官方工具中观察到的 GLM Coding Plan
> 用量监控端点读取数据；这些端点未经文档化，可能随时变更且不另行通知。本包可能在任何时候失效。

在 [pi coding agent](https://github.com/earendil-works/pi-mono) 底部状态栏显示 GLM Coding Plan
（国内版 / 国际版）配额用量，附带阈值提醒与详细的 `/glm-usage` 报告命令。

```
GLM 5h 34%↻1h40m·W 2%
```

## 功能

- **状态栏显示**：当任一 GLM 套餐供应商（`zai-coding-cn` 或 `zai`）处于活动状态时，以已用百分比显示
  5 小时窗口与周配额，最近一次重置的倒计时，阈值配色，以及数据过期时的 `~` 标记。切换到其他供应商时自动清除。
- **阈值提醒**：每个配额窗口、每个阈值档（80% 与 95%）仅提示一次；按重置窗口身份去重，
  用量大幅回落时重新武装，状态跨会话持久化。
- **`/glm-usage`**：覆盖层完整报告——套餐等级、全部配额段及重置时间、近 24 小时按模型 / 按工具用量明细
  （明细端点已在国内版套餐上验证；不可用时报告降级为仅配额）。`/glm-usage --json` 输出原始合并数据。
- **克制的客户端**：按供应商选择认证方式（国内版裸 key，国际版 Bearer），401 时一次回退，
  认证熔断器，429/5xx 遵循 `Retry-After` 的退避，请求超时，以及出错时保留过期值而非刷屏报错。
  无头模式（`pi -p`）不发起任何网络请求。

## 安装

npm（推荐——可被 [包画廊](https://pi.dev/packages) 索引）：

```bash
pi install npm:@zhaoji-wang/pi-glm-usage
```

或从 git 安装：

```bash
pi install git:github.com/frederick-wang/pi-glm-usage
```

## Key 配置

本扩展遵循 pi 自身的凭据优先级：

1. `~/.pi/agent/auth.json`（或 `$PI_CODING_AGENT_DIR/auth.json`）——国内版写入
   `"zai-coding-cn": { "type": "api_key", "key": "…" }`，国际版写入 `"zai": { … }`；
2. 否则读取环境变量 `ZAI_CODING_CN_API_KEY` / `ZAI_API_KEY`。

两者同时存在且不一致时，提示一次警告并使用 auth.json 的 key（pi 的优先级）。
auth.json 损坏时给出明确错误，而不是静默改用其他账号的凭据。

## 界面语言

状态栏本身为语言中立的符号。提示、报告与错误指引遵循 `PI_GLM_USAGE_LANG`（`zh` 或 `en`）；
未设置时读取进程 locale（特意设置的中文 shell locale 视为中文意图）；否则为英文。
`--json` 输出对脚本消费者保持稳定的英文字段。

## 为什么有这个包

npm 上已存在一个未加 scope 的 `pi-glm-usage`。本包存在的原因：覆盖国内版套餐（ incumbent
硬编码了国际版端点）、按活动供应商门控、并增加报告命令、阈值提醒与退避。
事实性对比（截至 2026-08-27，本包 0.1.1，incumbent 0.1.2；以[英文版 README](./README.md) 对比表为准）：

| | @zhaoji-wang/pi-glm-usage | 未加 scope 的 pi-glm-usage |
| --- | --- | --- |
| 国内版端点（open.bigmodel.cn） | 是 | 否 |
| 国际版端点（api.z.ai） | 是 | 是 |
| 切换供应商时清除状态栏 | 是 | 否（始终显示） |
| 详细报告命令 | 是（`/glm-usage`、`--json`） | 否 |
| 阈值提醒 | 是 | 否 |
| 退避 / 认证熔断器 | 是 | 固定 60 秒重试 |
| 界面消息语言 | 中/英（`PI_GLM_USAGE_LANG` 或 locale；状态栏语言中立） | 仅英文 |
| Key 来源 | auth.json → 环境变量，冲突警告 | 仅 auth.json 的 `zai` |
| pi peer 依赖 | `@earendil-works/pi-coding-agent` | 改名前的旧包名 |
| 发布测试 | 有 | 无 |

若 incumbent 增加了国内版支持，此表将更新或移除。

## 隐私

无遥测。API key 仅在本地读取，且只用于请求套餐自身的监控端点
（`open.bigmodel.cn` / `api.z.ai`）；没有任何数据发往其他地方。提醒去重状态保存在本地 pi 会话文件中。

## 限制

- Node 内置 `fetch` 不读取 `HTTPS_PROXY`；若 pi 本身能通过代理工作而状态栏显示过期数据，原因即在此。
- 监控端点未经文档化。百分比语义已在国内版套餐上实测验证（已用百分比，0–100）；
  未知配额单元代码在状态栏中被忽略，在报告中以通用形式呈现。

## 开发

本仓库使用 pnpm（见 `package.json` 的 `packageManager` 字段）。需要 Node ≥ 23.6（原生 TypeScript
类型剥离）；CI 使用 Node 24。

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run live-check  # 解析真实 key 并获取一次快照
```

MIT 许可证。欢迎贡献。
