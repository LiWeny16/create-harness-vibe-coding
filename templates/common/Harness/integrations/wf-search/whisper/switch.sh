#!/bin/bash
# Existing ai profile switcher extended with the mutually-exclusive Whisper profile.
set -e
PROFILE="${1:-}"
MODELS_ROOT="${WF_SEARCH_MODELS_ROOT:-${HOME:?HOME is required}/models}"
PROFILE_DIR="$MODELS_ROOT/profiles"
WHISPER_USER="${WF_SEARCH_WHISPER_USER:-${USER:-$(id -un)}}"
WHISPER_UNIT="${WF_SEARCH_WHISPER_UNIT:-whisper-server@$WHISPER_USER}"

if [ "$PROFILE" = "whisper" ]; then
    [ -f /etc/systemd/system/whisper-server@.service ] || { echo "whisper-server@.service is not installed"; exit 1; }
    sudo systemctl stop llama-server 2>/dev/null || true
    sudo systemctl stop whisper-server 2>/dev/null || true
    sudo systemctl stop "$WHISPER_UNIT" 2>/dev/null || true
    echo "$PROFILE" > "$PROFILE_DIR/.current"
    sudo systemctl daemon-reload
    sudo systemctl start "$WHISPER_UNIT"
    for i in $(seq 1 180); do
        if curl -sf -m 3 http://127.0.0.1:8090/health >/dev/null 2>&1; then
            echo "switched to whisper (~$((i*5))s)"
            exit 0
        fi
        sleep 5
    done
    echo "whisper did not become healthy; check: ai status"
    exit 1
fi

PROFILE_FILE="$PROFILE_DIR/$PROFILE.service"
[ -f "$PROFILE_FILE" ] || { echo "unknown profile: $PROFILE"; echo "available:"; ls "$PROFILE_DIR"/*.service 2>/dev/null | xargs -n1 basename; exit 1; }
sudo systemctl stop "$WHISPER_UNIT" 2>/dev/null || true
sudo systemctl stop whisper-server 2>/dev/null || true
cp "$PROFILE_FILE" /tmp/llama-server.service.wf-search
sudo install -o root -g root -m 644 /tmp/llama-server.service.wf-search /etc/systemd/system/llama-server.service
rm -f /tmp/llama-server.service.wf-search
echo "$PROFILE" > "$PROFILE_DIR/.current"
sudo systemctl daemon-reload && sudo systemctl restart llama-server
for i in $(seq 1 36); do
    if curl -sf -m 3 http://127.0.0.1:8080/health >/dev/null 2>&1; then
        echo "switched to $PROFILE (~$((i*5))s)"
        exit 0
    fi
    sleep 5
done
echo "Qwen profile did not become healthy; check: ai status"
exit 1
