# wf-search Whisper integration

This directory contains the optional localhost-only Whisper service and the
`ai` profile patch used by wf-search media transcription.

Install `whisper-server@.service` as
`/etc/systemd/system/whisper-server@.service`, run `systemctl daemon-reload`,
then start it for the current user:
`sudo systemctl start whisper-server@$(id -un)`. The unit expects the service user's environment at
`~/ai/whisper` with its `.venv`, and stores model data under `~/models/whisper`.
Those paths are resolved by systemd's `%h` specifier, so the unit works with
different Linux usernames. An optional `/etc/default/wf-search-whisper` file
can override the `WHISPER_*` environment settings.

`switch.sh` reads profiles from `${WF_SEARCH_MODELS_ROOT:-$HOME/models}/profiles`
and accepts `WF_SEARCH_WHISPER_UNIT` to select a non-default systemd unit.
The HTTP server binds to `127.0.0.1` by default.
