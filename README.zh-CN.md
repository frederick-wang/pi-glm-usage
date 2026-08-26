# pi-glm-usage

**[English](./README.md)** | 简体中文

> **非官方项目。** 与智谱 AI / Z.ai 无关联。通过智谱官方工具中观察到的 GLM Coding Plan
> 用量监控端点读取数据；这些端点未经文档化，可能随时变更且不另行通知。本包可能在任何时候失效。

在 [pi coding agent](https://github.com/earendil-works/pi-mono) 底部状态栏显示 GLM Coding Plan
（国内版 / 国际版）配额用量，附带阈值提醒与详细的 `/glm-usage` 报告命令。

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
| `5h` / `W` / `M` | 5 小时滚动 token 窗口 / 周配额 / MCP 月度配额；至多显示两段（先 5h，再 W 或 M） |
| `34%` | 该窗口已用百分比（整数，0–100） |
| `↻2h 40m` | 最近重置段的剩余时间；每 30 秒本地重算，不发网络请求；7 天内显示星期+时间（`↻Sat 05:00`），更远显示日期（`↻Sep06`） |
| `~` | 显示值为过期数据：上次刷新失败，保留旧值 |
| 颜色 | 绿 < 50%，黄 50–79%，红 ≥ 80% |

### 阈值提醒

用量越过 80% 或 95% 时，每个配额窗口每档提示一次：

```
GLM 5h 配额已用 85%（越过 80%）
```

阈值附近抖动不重复提示；回落 20 个百分点及以上重新武装该档；
提醒状态写入会话文件，重启后仍生效。

### `/glm-usage`

打开覆盖层，显示全部配额段与近 24 小时按模型 / 按工具用量
（明细端点已在国内版套餐验证；国际版降级为仅配额）：

```
GLM Coding Plan — max
  5h window   34% used   resets in 2h 40m
  Weekly      2% used   resets in Sat 05:00
  MCP         1% used   resets in Sep06

Model usage (last 24h):
  GLM-5.3  31436935
  GLM-4.7  296701
```

（示例为英文界面；中文界面文案见上文"界面语言"。）

`/glm-usage --json` 输出原始合并数据（配额快照、查询窗口、明细数组），
仅支持 TUI 与 print 模式。

### 刷新行为

激活时与 `/glm-usage` 时获取；每轮对话后至多每 180 秒一次
（任一 token 窗口 ≥ 80% 后收紧到 60 秒）。429/5xx 遵循 `Retry-After` 退避；
凭据被拒两轮后熔断，停止请求，直到下次切换模型或执行 `/glm-usage`。
无头运行（`pi -p`）不发任何请求。

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

npm 上已存在一个未加 scope 的 `pi-glm-usage`。事实性对比见
[英文版 README](./README.md#why-another-package)（截至 2026-08-27，本包 0.1.1，incumbent 0.1.2）；
若 incumbent 增加国内版支持，该表将更新或移除。

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

MIT 许可证（见 [LICENSE](./LICENSE)）。
