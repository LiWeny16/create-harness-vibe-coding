# UI Contract: {{FEATURE_NAME}}

| Element | data-testid | Accessible Role/Label | States | AC IDs |
| --- | --- | --- | --- | --- |
| {{ELEMENT}} | `{{TEST_ID}}` | {{ROLE_OR_LABEL}} | default, loading, error, disabled | AC-001 |

Rules:

- Prefer `data-testid` for critical automation selectors.
- Accessible role/label may supplement but must not be unstable.
- Cover inputs, buttons, rows/items, empty state, loading state, and error state.
