#!/usr/bin/env python3
"""Upgrade the existing ai command with explicit Qwen/Minimax/Whisper semantics."""

from pathlib import Path
import os
import re
import shutil


TARGET = Path(os.environ.get("AI_TARGET", "/usr/local/bin/ai"))
MARKER = "# wf-search whisper integration v3"


def replace_once(text, pattern, replacement, label):
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE | re.DOTALL)
    if count != 1:
        raise RuntimeError(f"could not patch {label}")
    return updated


text = TARGET.read_text()
if MARKER in text:
    print(f"ai already contains {MARKER}")
    raise SystemExit(0)

backup = TARGET.with_name("ai.bak-wf-search-whisper")
if not backup.exists():
    shutil.copy2(TARGET, backup)

# Remove an earlier integration when upgrading an already-deployed host.
text = re.sub(
    r'\n# wf-search whisper integration v2\n_wait_whisper\(\) \{.*?\n\}\n\n_start_qwen\(\) \{.*?\n\}\n\n_start_whisper\(\) \{.*?\n\}\n',
    "\n",
    text,
    count=1,
    flags=re.MULTILINE | re.DOTALL,
)

# Remove the first-generation integration when upgrading the original host.
text = re.sub(
    r'\n# wf-search whisper integration\n_wait_whisper\(\) \{.*?\n\}\n',
    "\n",
    text,
    count=1,
    flags=re.MULTILINE | re.DOTALL,
)

integration = r'''

# wf-search whisper integration v3
WHISPER_UNIT="${WF_SEARCH_WHISPER_UNIT:-whisper-server@${USER:-$(id -un)}}"
_stop_whisper() {
    # Stop the previous single-user unit as well as this user's templated unit.
    sudo systemctl stop whisper-server 2>/dev/null || true
    sudo systemctl stop "$WHISPER_UNIT" 2>/dev/null || true
}
_wait_whisper() {
    echo "[*] waiting for Whisper model load..."
    for i in $(seq 1 180); do
        sleep 5
        if curl -sf -m 3 http://127.0.0.1:8090/health >/dev/null 2>&1; then
            echo "ready (~$((i*5))s) -> http://127.0.0.1:8090"
            return 0
        fi
        printf "."
    done
    echo
    echo "[!] Whisper not healthy yet, check: ai status"
    return 1
}

_start_qwen() {
    _minimax_off_quiet
    _stop_whisper
    if [ ! -f "$P/fast.service" ]; then
        echo "[!] missing Qwen profile: $P/fast.service"
        return 1
    fi
    # Bare ai on is deliberately deterministic: Qwen 3.8 27B is the default.
    sudo cp "$P/fast.service" /etc/systemd/system/llama-server.service
    echo fast > "$P/.current"
    sudo systemctl daemon-reload
    sudo systemctl start llama-server
    echo "[*] waiting for Qwen 3.8 27B model load..."
    for i in $(seq 1 36); do
        sleep 5
        if curl -sf -m 3 http://127.0.0.1:8080/health >/dev/null 2>&1; then
            echo "ready (~$((i*5))s)"
            return 0
        fi
        printf "."
    done
    echo
    echo "[!] Qwen not healthy yet, check: ai status"
    return 1
}

_start_whisper() {
    _minimax_off_quiet
    sudo systemctl stop llama-server 2>/dev/null || true
    echo whisper > "$P/.current"
    sudo systemctl start "$WHISPER_UNIT"
    _wait_whisper
}
'''
text = text.replace('\ncase "$1" in', integration + '\ncase "$1" in', 1)

text = replace_once(
    text,
    r'^on\)\n.*?^    ;;\n(?=off\))',
    '''on)
    action="${2:-qwen}"
    case "$action" in
    qwen)
        _start_qwen
        ;;
    minimax)
        exec "$0" minimax on
        ;;
    whisper)
        _start_whisper
        ;;
    *)
        echo "usage: ai on [qwen|minimax|whisper]"
        exit 2
        ;;
    esac
    ;;
''',
    "ai on",
)

text = replace_once(
    text,
    r'^off\)\n.*?^    ;;\n(?=minimax\))',
    '''off)
    _minimax_off_quiet
    sudo systemctl stop llama-server 2>/dev/null || true
    _stop_whisper
    sudo sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches'
    echo "[ok] stopped Qwen, Whisper, Minimax and cleaned VRAM"
    echo "  GPU: $(nvidia-smi --query-gpu=memory.used --format=csv,noheader)"
    free -g | sed -n 2p | awk '{print "  RAM: used "$3"G, available "$7"G"}'
    echo "  CPU: $(uptime | grep -oE "load average.*")"
    ;;
''',
    "ai off",
)

# The existing nested Minimax command predates Whisper. Add the same exclusion
# there when this script is applied to an unpatched copy of ai.
text = re.sub(
    r'^(        sudo systemctl stop llama-server 2>/dev/null\n)(?!        sudo systemctl stop whisper-server)',
    r'\1        sudo systemctl stop whisper-server 2>/dev/null || true\n',
    text,
    count=1,
    flags=re.MULTILINE,
)

text = replace_once(
    text,
    r'^status\)\n.*?^    ;;\n(?=switch\))',
    '''status)
    PROFILE=$(cat "$P/.current" 2>/dev/null || echo unknown)
    echo "== profile =="
    echo "$PROFILE"
    echo "== qwen =="
    systemctl is-active llama-server
    echo "== qwen health =="
    curl -sf -m 5 $URL/health || true
    echo
    echo "== whisper =="
    systemctl is-active "$WHISPER_UNIT"
    echo "== whisper health =="
    curl -sf -m 5 http://127.0.0.1:8090/health || true
    echo
    echo "== minimax =="
    if curl -sf -m 3 "$H3_HEALTH" >/dev/null 2>&1; then echo "active (:8189)"; else echo "inactive"; fi
    echo "== gpu =="
    nvidia-smi --query-gpu=memory.used,memory.total,temperature.gpu --format=csv,noheader
    echo "== ram =="
    free -g | sed -n 2p
    echo "== watchdog =="
    systemctl is-active llama-watchdog.timer
    ;;
''',
    "ai status",
)

text = text.replace(
    'ai on | off | status | switch [fast|max|vision|official]',
    'ai on [qwen|minimax|whisper] | off | status | switch [fast|max|vision|official|whisper]',
    1,
)

text = replace_once(
    text,
    r'^logs\)\n.*?^    ;;',
    '''logs)
    PROFILE=$(cat "$P/.current" 2>/dev/null || echo fast)
    if [ "$PROFILE" = "whisper" ]; then journalctl -u "$WHISPER_UNIT" --no-pager -n 50; else journalctl -u llama-server --no-pager -n 50; fi
    ;;''',
    "ai logs",
)

TARGET.write_text(text)
print(f"patched {TARGET}; backup={backup}")
