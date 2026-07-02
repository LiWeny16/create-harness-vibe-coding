# API Contract: {{FEATURE_NAME}}

## {{METHOD}} {{PATH}}

Purpose: {{PURPOSE}}

Request:

```json
{
  "{{FIELD}}": "{{VALUE}}"
}
```

Success:

```json
{
  "ok": true
}
```

Failure:

```json
{
  "ok": false,
  "message": "{{ERROR_MESSAGE}}"
}
```

AC IDs: AC-001

Assertions:

- method and URL match
- payload shape matches
- success response updates expected state
- failure response shows expected UI/API error
- duplicate submission behavior is defined
