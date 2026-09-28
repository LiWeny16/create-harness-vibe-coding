# Remote Whisper verification

Date: 2026-09-17 (Asia/Shanghai)

The host-specific path was verified without recording credentials or cookies:

- `ai switch whisper` stopped the Qwen service, loaded `large-v3` on CUDA, and returned `switched to whisper (~365s)` on the first load.
- `ai status` returned profile `whisper`, health `{"status":"ok","model":"large-v3","device":"cuda"}`, and GPU use about 3.9 GiB of 20 GiB.
- `ai off` followed by `ai on` returned Whisper ready in about 5 seconds from the cached model.
- `ai switch fast` and then `ai switch whisper` both completed, exercising mutual exclusion and restoring Whisper.
- A 17.48-second speech sample transcribed through the SSH tunnel into 11 `large-v3` segments with word timestamps. The local transcript validator passed; searching `New York` returned 2 timestamped matches.

The client endpoint stayed private through `127.0.0.1:18090` forwarded to the
remote service's `127.0.0.1:8090`.
