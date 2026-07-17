# Memory Routes (L3 Route Index)

> L3 = 详细 durable memory 路由索引。不是详细 memory，而是命中规则索引。
> 详细 memory 文件按 scenario 匹配后按需加载。

| id | signals | load | avoid |
| --- | --- | --- | --- |
| explicit-user-preference | remember, next time, 下次, 记住, 不要再, never, always, I prefer | user-corrections-preferences.md | current-task-only notes, transient mood |
| hooks-only-wf-auto | hook, runtime hook, .claude/settings.json, .codex/hooks.json, WF-AUTO.md | agent-lessons-patterns.md#only-wf-auto-may-use-runtime-hooks | non-runtime docs, broad hook designs |
| tool-repeat-failure | same command fails 3x, error signature repeats | tool-usage-reflections.md | one-off command failures |
| review-debug-lesson | reusable review/debug/validation pattern | agent-lessons-patterns.md | task-specific logs |
| startup-digest | new session, startup | startup-hints.md | full MEMORY.md index |
| wf-closeout | /wf-learn, workflow closeout | all memory files via context-master -> memory-master | premature writes before extraction |

## Matching Algorithm

1. 把当前请求压缩成 **scenario pack**: intent / files / commands / signals / risk
2. 与上表 Signals 列匹配，计算 score:
   - +4 exact file/path match
   - +3 explicit trigger phrase match
   - +3 command/error signature match
   - +2 workflow/mode match
   - +1 keyword overlap
   - -4 avoid match
3. 阈值:
   - score >= 5: 加载对应 memory entry/file section
   - score 3-4: 只加载 route 摘要，必要时再读详细文件
   - score < 3: 不加载
4. Hard trigger 优先:
   - 用户显式记忆语句 -> user-corrections-preferences.md
   - 同命令失败 3 次 -> tool-usage-reflections.md
   - review/debug/validation 可复用 lesson -> agent-lessons-patterns.md
   - 修改 hook 相关文件 -> 加载 only-wf-auto hook lesson
   - /wf-learn -> 完整 learning cycle

## Load Logging

每次加载 memory hints 需说明原因:
```
memory hints loaded: <id> because <signal>
```

不使用 embedding；保持稳定、可解释、省 token。
