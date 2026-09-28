# Video Research

Video is evidence only after the Agent can point to a timestamped transcript
segment. Do not put an MP4, audio blob, or full subtitle file into the Agent's
context when a compact transcript artifact will do.

## Processing order

Use the first successful route and record why later routes were not needed:

1. Native captions/subtitles exposed by the platform.
2. An explicitly allowed audio-only or media download for a known URL.
3. Local or user-provided ASR, followed by a transcript contract check.
4. A remote user-owned Whisper ASR endpoint reached through transport supplied
   by the user environment. The endpoint must not be made public just for
   research.

Captions and ASR are different source types. Preserve the distinction in
`source` and report missing captions, download failures, language uncertainty,
and ASR limitations instead of silently substituting guesses.

## Transcript contract

The handoff artifact uses `schemaVersion: "wf-search/video-transcript.v1"`:

```json
{
  "schemaVersion": "wf-search/video-transcript.v1",
  "video": { "url": "https://...", "title": "...", "platform": "...", "retrievedAt": "..." },
  "language": "zh",
  "languageProbability": 0.99,
  "model": "large-v3",
  "source": "native-caption|asr",
  "segments": [
    { "id": 0, "startMs": 0, "endMs": 1800, "text": "...", "words": [] }
  ]
}
```

Every segment must have a stable non-negative `id`, non-negative `startMs`,
`endMs > startMs`, and non-empty `text`. Word timestamps are optional. The
validator is `node Harness/scripts/wf-search-video.mjs validate --input ...`.

## Agent handoff

Expose only these operations to the Agent layer:

- `video.search_transcript(transcript, query)` returns matching segments.
- `video.read_segments(transcript, ids)` returns bounded excerpts with times.
- `video.summarize_with_citations(transcript)` cites the original URL and
  `startMs/endMs` for each material point.

The local helper can upload media to an explicitly supplied endpoint with
`transcribe`, normalize seconds into milliseconds, and save the compact JSON
artifact. It does not send cookies and does not decide whether a platform
download is permitted.

## Backend configuration

ASR and VLM services are user-owned infrastructure. `wf-search` does not
contain a host name, IP address, SSH user, tunnel command, fixed port, cookie,
or credential. It reads only the separate JSON configuration file
`Harness/extensions/config.json`, validated as
`wf-search/backend-config.v1`:

```json
{
  "schemaVersion": "wf-search/backend-config.v1",
  "backends": {
    "whisper": { "baseUrl": "<user-configured-service-url>" },
    "vlm": { "baseUrl": "<user-configured-openai-compatible-url>", "model": "<user-configured-model>" }
  }
}
```

The transport, routing, authentication, model switching, and GPU lifecycle
are owned by the user environment. `wf-search` performs health checks, sends
the explicitly selected media or frames, and records failures; it does not
install or operate a particular backend machine. The backend owner should
ensure that only a compatible GPU model set is active before a health check.

Use the configured backend like this:

```text
node Harness/scripts/wf-search-video.mjs transcribe --config Harness/extensions/config.json --backend whisper --input <media> --url <video-url> --title <title> --platform <platform> --output <transcript.json>
node Harness/scripts/wf-search-video.mjs validate --input <transcript.json> --json
```

Only a successful health check, a valid ASR response, and timestamp contract
validation make a transcript usable evidence. A VLM result is usable only
when its endpoint/model health is known and every visual claim cites the
frame timestamps used to support it.


