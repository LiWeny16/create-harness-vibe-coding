# Startup Hints (L2 Memory Digest)

> L2 = 启动极简 memory digest。每次 Harness 会话启动可读此文件，但不要加载完整 Harness/MEMORY.md 或 Harness/README.md。

## Core Principles

- Memory 是短场景规则，不是 task log。
- 时间戳默认不要写；只有 superseded / conflict / time-sensitive 才写。
- Broad runtime hooks 禁止；只有 `/wf-auto` bounded tick hook 例外。
- Direct mode 不加载完整 Harness router，但 startup-hints 是允许的轻量启动提示。
- 详细 memory 仍按 `MEMORY_PROTOCOL.md` 场景命中后再读。

## Memory Candidate Detection

用户说以下触发词时，识别为 memory candidate：

**英文**: remember, next time, don't, do not, never, always, I prefer, I want you to
**中文**: 记住, 下次, 以后, 不要再, 总是, 永远不要, 我偏好, 我希望你以后

## When to Write Memory

- **Explicit user preference**: 清晰、安全、场景明确时，可立即写入 L3，不必等 `/wf-learn`。
- **Repeated implicit correction**: 同一假设/模式被纠正 2+ 次。
- **Tool/command failure**: 同类工具/命令失败 3+ 次。
- **Review/debug lesson**: 只有可复用、能防回归时才写。

## What NOT to Write

- Task log、过程总结、一次性情绪
- Raw logs、transcripts
- Secrets, tokens, credentials, private data
- 临时偏好、无复用价值的笔记
