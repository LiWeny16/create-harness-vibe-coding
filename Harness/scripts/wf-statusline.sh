#!/bin/bash
# wf-statusline.sh — Unix statusline badge for WF-MAX / WF-REVIEW
# Displays mode + agentRole from Harness/.runtime/current-mode.json
# Role-aware: shows all roles (CEO/MGR/WRK/REV), not just CEO.
#
# Usage in .claude/settings.json:
#   "statusLine": { "type": "command", "command": "bash Harness/scripts/wf-statusline.sh" }
#
# Security: refuses symlinks, validates JSON, caps read size.

MODE_FILE="$(dirname "$0")/../.runtime/current-mode.json"

# Resolve relative path to absolute (from project root or script location)
if [ ! -f "$MODE_FILE" ]; then
  MODE_FILE="Harness/.runtime/current-mode.json"
fi

[ -L "$MODE_FILE" ] && exit 0   # Refuse symlinks
[ ! -f "$MODE_FILE" ] && exit 0 # Missing file

# Read with python for safe JSON parse (jq may not be installed).
MODE=$(python3 -c "
import json, os, sys
try:
  fpath = sys.argv[1]
  if os.path.getsize(fpath) > 16384: sys.exit(1)
  with open(fpath, 'r') as f:
    d = json.load(f)
  if not d.get('active'): sys.exit(1)
  agent_role = d.get('agentRole') or d.get('role') or ''
  role_short = {'ceo':'CEO','manager':'MGR','worker':'WRK','reviewer':'REV'}.get(agent_role, '')
  print(d.get('mode','') + '|' + d.get('phase','') + '|' + role_short)
except: pass
" "$MODE_FILE" 2>/dev/null)

[ -z "$MODE" ] && exit 0

MODE_NAME="${MODE%%|*}"
REST="${MODE#*|}"
MODE_PHASE="${REST%%|*}"
MODE_ROLE="${REST##*|}"

case "$MODE_NAME" in
  wf-max)
    PHASE_SHORT=$(echo "$MODE_PHASE" | sed 's/W._/W/')
    if [ -n "$MODE_ROLE" ]; then
      printf '\033[38;5;75m[WF-MAX:%s:%s]\033[0m' "$MODE_ROLE" "$PHASE_SHORT"
    else
      printf '\033[38;5;75m[WF-MAX:%s]\033[0m' "$PHASE_SHORT"
    fi
    ;;
  wf-review)
    printf '\033[38;5;178m[WF-REVIEW]\033[0m'
    ;;
esac
