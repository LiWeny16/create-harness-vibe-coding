---
name: wf-browser
description: Built-in browser automation and E2E verification workflow. Use for Claude /wf-browser, Codex $wf-browser or /skills wf-browser, Browser Use, Playwright, Chrome DevTools/CDP, screenshots, forms, UI verification, and browser-visible acceptance.
---

# WF Browser

This skill is the single Browser E2E entry. Do not use or create a separate
browser E2E skill. The browser evidence contract lives here plus
`Harness/specs/protocols/HARNESS_BRIDGE.md`.

## Invocation

- Claude Code: use `/wf-browser <task>` or select the `wf-browser` skill.
- Codex CLI or IDE: use `$wf-browser <task>` or `/skills` then choose `wf-browser`.
- OpenCode: use `/wf-browser <task>`.

## Load

- `CLAUDE.md`
- `Harness/MEMORY.md` index only per Memory Preflight
- `Harness/README.md`
- `Harness/specs/protocols/HARNESS_BRIDGE.md`
- Project run/build/test instructions
- Official Browser Use skill text from `browser-use skill` when Browser Use is used

## Cache Discipline

Follow `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`: keep stable
workflow docs first, then append only the current URL, selectors, concise browser
state, screenshot paths, trace paths, and failing assertions. Do not paste full
accessibility trees, browser logs, screenshots, videos, or network dumps into
task state.

## Browser Evidence Contract

Every browser-visible claim needs real browser evidence:

1. URL and viewport/browser scope.
2. Stable selector contract using `data-testid` and accessible labels/roles.
3. Real interaction evidence from Browser Use, Playwright, Chrome DevTools/CDP,
   or documented manual browser checks.
4. Console and network checks for runtime exceptions, failed requests, and
   frontend-backend side effects.
5. Screenshot, trace, video, state snapshot, or command output path.
6. AC-by-AC validation matrix when acceptance criteria exist.

No `data-testid` or stable accessible selector, no UI acceptance. No API
contract, no backend integration acceptance.

## Controllable UI Contract

UI built for browser control must expose targetable, user-meaningful controls:

| Category | Required control surface |
| --- | --- |
| Inputs | `<label>` association or `aria-label`, `data-testid`, disabled/invalid states, deterministic placeholder only as fallback |
| Buttons | accessible name, `data-testid`, disabled/loading state, no icon-only button without `aria-label` |
| Filters | stable test id for input/menu/chip, selected state, clear/reset control |
| Rows/items | stable row/item test id plus durable item key such as `data-row-id`; avoid index-only targeting |
| Empty state | visible empty container with `data-testid="empty-state"` or feature-specific equivalent |
| Error state | inline error/toast/banner with stable test id and accessible role when appropriate |
| Loading state | stable spinner/skeleton/progress test id; verify duplicate submit prevention |

Required coverage targets: inputs, buttons, filters, rows, empty/error/loading states.

Selector priority:

1. `data-testid`
2. accessible labels/roles
3. visible text for stable user-facing copy

Do not use generated class names, brittle CSS chains, XPath, DOM index selectors,
or raw coordinates as the primary test contract. Coordinates are acceptable only
after locating an element through the accessibility tree or when testing canvas
or other non-DOM UI.

## Browser Use CLI

Use the current script-style Browser Use CLI; old `browser-use open/state/click/screenshot/input/wait` subcommands are removed from the current CLI and must not be used in new docs or tests.

Health check:

```bash
browser-use --doctor
browser-use skill
```

PowerShell smoke:

```powershell
@'
new_tab("https://example.com")
wait_for_load()
print(page_info())
path = capture_screenshot("Harness/tasks/<task-id>/evidence/example.png")
print(path)
'@ | browser-use
```

Bash smoke:

```bash
browser-use <<'PY'
new_tab("https://example.com")
wait_for_load()
print(page_info())
path = capture_screenshot("Harness/tasks/<task-id>/evidence/example.png")
print(path)
PY
```

Useful helpers include `new_tab(url)`, `goto_url(url)`, `page_info()`,
`capture_screenshot(path)`, `click_at_xy(x, y)`, `type_text(text)`,
`fill_input(selector, text)`, `press_key(key)`, `scroll(x, y)`, `js(code)`,
`cdp(method, ...)`, `wait_for_load()`, `wait_for_element(selector)`,
`list_tabs()`, `switch_tab(target)`, and `close_tab(target)`.

For local Chrome connection problems, run `browser-use --doctor`. If Chrome asks
to allow remote debugging, stop and ask the user to approve the browser prompt.

## Playwright Test Pattern

Prefer Playwright for repeatable E2E tests and Browser Use/CDP for exploratory
or interactive checks.

```ts
import { test, expect } from "@playwright/test";

test("AC-001 user can submit the form", async ({ page }) => {
  const requests: Array<{ url: string; method: string; postData: string | null }> = [];
  page.on("request", request => {
    requests.push({
      url: request.url(),
      method: request.method(),
      postData: request.postData(),
    });
  });

  await page.goto("/example");
  await page.getByTestId("email-input").fill("test@example.com");
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page.getByTestId("loading-spinner")).toBeHidden();
  await expect(page.getByTestId("result-row")).toBeVisible();
  expect(requests.some(request => request.url.includes("/api/example"))).toBe(true);
});
```

## Chrome DevTools / CDP Checklist

- [ ] Record URL, port, browser, and viewport.
- [ ] Verify available Browser Use, Playwright, CDP, MCP, or manual tooling.
- [ ] Check not just HTTP 200.
- [ ] Verify no runtime exceptions, console errors, and failed network requests.
- [ ] Confirm stable accessible labels/roles or `data-testid` on interactive elements.
- [ ] Test the critical flow end-to-end with real user actions.
- [ ] Capture screenshot, trace, video, state snapshot, or result artifact paths.
- [ ] Produce an AC-by-AC validation matrix.
- [ ] Clean up dev server or browser processes that the task started.

## Security

- Never log or screenshot real credentials, API keys, tokens, or private data.
- Use placeholder credentials in examples.
- Ask before using a real Chrome profile because it contains cookies and private sessions.
- Ask before leaving a remote/cloud browser running.
- For scraping or repeated automated visits, confirm the user owns the target or has permission.

## Return

- Commands or scripts run
- Selectors used
- Screenshot/trace/video/state paths
- Verified flows and AC matrix
- Failures and remaining risks
