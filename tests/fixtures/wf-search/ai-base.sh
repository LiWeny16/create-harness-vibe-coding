#!/bin/bash
URL="http://127.0.0.1:8080"
APIKEY="placeholder"
P=/home/onion/models/profiles
H3_DIR=/home/onion/ai/h3/ComfyUI
H3_PY=$H3_DIR/.venv/bin/python
H3_LOG=/home/onion/ai/h3/server_200.log
H3_PID=/home/onion/ai/h3/comfyui.pid
H3_HEALTH="http://127.0.0.1:8189/system_stats"

_minimax_off_quiet() { return 0; }

case "$1" in
on)
    _minimax_off_quiet
    sudo systemctl start llama-server
    echo "ready"
    ;;
off)
    sudo systemctl stop llama-server
    sudo sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches'
    echo "stopped"
    ;;
minimax)
    action="${2:-on}"
    echo "minimax $action"
    ;;
status)
    echo "status"
    ;;
switch)
    sudo "$P/switch.sh" "$2"
    ;;
logs)
    journalctl -u llama-server --no-pager -n 50
    ;;
*)
    echo "用法: ai on | off | status | switch [fast|max|vision|official] | key | logs | minimax [on|off|status|logs]"
    ;;
esac
