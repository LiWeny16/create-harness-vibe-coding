# UI Contract: {{FEATURE_NAME}}

| Element | Capability ID | data-testid | Accessible Role/Label | Actions | Captures | States | AC IDs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| {{ELEMENT}} | `{{CAPABILITY_ID}}` | `{{TEST_ID}}` | {{ROLE_OR_LABEL}} | `act.click`, `act.intent({{CAPABILITY_ID}})` | screenshot, ui-tree, state, logs | default, loading, error, disabled | AC-001 |

Rules:

- Prefer `data-testid` for critical automation selectors.
- Use stable accessible labels/roles for controls and icon-only buttons.
- Add capability ids for first-party route, component, form, table, graph, canvas, and element targets.
- Declare supported `act.*` operations and `observe.*` captures for complex widgets.
- Cover inputs, buttons, filters, rows/items, empty state, loading state, and error state.
