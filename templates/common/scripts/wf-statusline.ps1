#!/usr/bin/env pwsh
# wf-statusline.ps1 — Statusline badge for WF-MAX / WF-REVIEW modes
# Displays mode + agentRole from Harness/.runtime/current-mode.json
# Role-aware: shows all roles (CEO/MGR/WRK/REV), not just CEO.
#
# Usage in .claude/settings.json:
#   "statusLine": { "type": "command", "command": "pwsh -File Harness/scripts/wf-statusline.ps1" }
#
# Security: refuses symlinks, validates JSON, caps read size.

param()

$MODE_FILE = Join-Path $PSScriptRoot '..' '.runtime' 'current-mode.json'

# Refuse symlinks / missing file
if (-not (Test-Path $MODE_FILE -PathType Leaf)) { exit 0 }
$item = Get-Item $MODE_FILE -Force
if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { exit 0 }

# Size cap
if ($item.Length -gt 16384) { exit 0 }

try {
  $json = Get-Content $MODE_FILE -Raw -ErrorAction Stop | ConvertFrom-Json
} catch {
  exit 0 # Silent-fail
}

if (-not $json.active) { exit 0 }

# Use agentRole first, fall back to legacy 'role' field
$agentRole = if ($json.agentRole) { $json.agentRole } else { $json.role }

switch ($json.mode) {
  'wf-max' {
    $phase = if ($json.phase) { ":$($json.phase -replace 'W\d_','W')" } else { '' }
    $roleShort = switch ($agentRole) {
      'ceo'      { 'CEO' }
      'manager'  { 'MGR' }
      'worker'   { 'WRK' }
      'reviewer' { 'REV' }
      default    { '' }
    }
    $badge = if ($roleShort) { "[WF-MAX:${roleShort}${phase}]" } else { "[WF-MAX${phase}]" }
    Write-Host -NoNewline "`e[38;5;75m${badge}`e[0m"
  }
  'wf-review' {
    Write-Host -NoNewline "`e[38;5;178m[WF-REVIEW]`e[0m"
  }
}
