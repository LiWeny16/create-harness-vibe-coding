---
name: wf-browser
description: "Thin Agent adapter for browser control provided by the optional wf-ui extension."
---

# WF-BROWSER

Browser control is an optional capability of wf-ui. This skill does not contain
the browser bridge protocol, UI tree schema, action catalog, lease lifecycle,
or evidence implementation.

Before browser work:

1. Check wf-ui through wf extension status.
2. Request explicit installation when missing.
3. Call the CLI-backed wf ui/browser command and keep large artifacts on disk.
4. Return compact session, lease, capability, and artifact references.

The installed extension owns BrowserOS/CDP/Playwright adapters, browser sessions,
semantic capability maps, observe/act primitives, leases, screenshots, traces,
and cleanup. Never paste full DOM trees, screenshots, videos, or network dumps
into Agent context.
