# Claude Luna/xhigh readiness（只读）

日期：2026-09-09。范围为本项目与用户级 settings、已知本机 managed-settings 路径、用户全局配置的白名单键名扫描、项目 agent frontmatter、当前 `claude` CLI 版本/help 及当前 shell 环境变量名。只输出 model/effort 等白名单非敏感字段；不输出 gateway 地址、headers、token、key、完整 env 或全局配置私有内容，不读取 credential store，未联网携带凭据，未启动会话、推理或 benchmark。

## 当前可见事实

| 项目 | 结果 |
|---|---|
| CLI | `Claude Code 2.1.215`，可见 `--effort low/medium/high/xhigh/max`（help 还列出 `ultracode`）；可见 `--model <alias\|full name>` |
| 项目 settings | `.claude/settings.json` 可解析；顶层仅 `$schema`、`permissions`、`hooks`，无 `model`、`effortLevel`、`modelSettings`、`availableModels` 或 `env`；`.claude/settings.local.json` 不存在 |
| 项目 agent 模型 | `.claude/agents/*.md` 的 `model` frontmatter 仅发现 `sonnet`、`haiku`；没有 `gpt-5.6-luna` 或 `xhigh` 声明 |
| 用户 settings | `%USERPROFILE%\.claude/settings.json` 可解析：`model=fable`、`effortLevel=xhigh`；无 `availableModels`、`modelSettings`。白名单 model env 声明为 `ANTHROPIC_DEFAULT_FABLE_MODEL=claude-fable-5[1M]`、`ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-4-5`、`ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-8[1M]`、`ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-6`、`CLAUDE_CODE_SUBAGENT_MODEL=qwen3.8-max`；未声明 `gpt-5.6-luna` |
| 用户 local / 已知本机 managed settings | `%USERPROFILE%\.claude/settings.local.json`、`%ProgramData%\ClaudeCode\managed-settings.json`、`%ProgramFiles%\ClaudeCode\managed-settings.json` 均不存在 |
| 全局配置 | `%USERPROFILE%\.claude.json` 存在；因其含登录/MCP 私有状态，只扫描白名单键名，`model`/`effortLevel`/`availableModels`/`modelSettings` 均未发现；未读取/输出其余内容 |
| 当前 shell 可见变量名 | 仅见 `CLAUDE_CODE_SSE_PORT`；未见 `ANTHROPIC_MODEL`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_CUSTOM_MODEL_OPTION`、`ANTHROPIC_DEFAULT_*_MODEL`、effort 变量（不输出任何变量值） |
| custom gateway | **true**（用户 settings 的 `env` 声明包含 `ANTHROPIC_BASE_URL`；地址本身不输出）。这只证明配置了 gateway 入口，不证明该 gateway/账号提供 Luna |

结论分类：**仅当前选项而未声明能力**。用户 settings 确实声明了 `fable` + `xhigh` 选择和 custom gateway，但没有精确 `gpt-5.6-luna`；`xhigh` 选择不是 provider 能力证明。已知 managed 文件与 shell 未补充精确组合，server/MDM/组织策略仍未通过会话查询，因此 Claude 的 `gpt-5.6-luna/xhigh` 能力仍为 `UNVERIFIED`。Codex/OpenCode 的可用性不外推到 Claude。

## 覆盖与防止静默换模

官方 settings 说明 managed > `--settings`/启动参数 > project-local > shared project > user；环境变量按具体 key 覆盖（如 `ANTHROPIC_MODEL` 覆盖文件中的 `model`）。`availableModels` 在 managed 层可限制 `/model`、`--model`、subagent 等入口；`model` 本身只是初始选择，不能单独限制 Default。被 allowlist 阻断的启动 `--model`/环境变量/settings 值可能警告并替换到默认模型；`--fallback-model` 又会显式开启自动 fallback（仅 print 模式），因此严格 Luna 探针必须省略它。官方还说明 custom gateway/model ID 由 provider 定义，CLI 可能把字符串原样传递；JSON/stream-json 结果应检查 `modelUsage`，不能只看退出码或文本。

来源：

- [Claude Code model configuration](https://code.claude.com/docs/en/model-config)：模型选择优先级、`availableModels`/`enforceAvailableModels`、阻断替换、`modelUsage` 与 custom model option。
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage)：`--model`、`--effort`、`--fallback-model` 的当前参数语义。
- [Other LLM gateways](https://code.claude.com/docs/en/llm-gateway)：`ANTHROPIC_BASE_URL` 与 gateway discovery/凭据边界。

## 后续最小探针建议（未执行）

待用户明确授权 fresh benchmark 且确认 Claude 网关/非敏感配置后，可在隔离测试项目用一次明确 `--model gpt-5.6-luna --effort xhigh` 的最小、只读探针：不传 `--fallback-model`，allowlist 若由用户/托管策略提供则只允许该精确 ID，记录启动诊断、`modelUsage` 中的 requested/effective model 与 effort；缺 gateway、拒绝/unknown 或无可观测元数据均报告 `UNVERIFIED`，不得改用 Opus/别的模型。该探针仍可能产生 provider 费用，必须由用户先授权；本证据不构成 B3/任何 AC 通过。
