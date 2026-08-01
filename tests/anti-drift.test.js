import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, ...rel.split('/')));
}

function walkFiles(rel, pattern, out = []) {
  const dir = path.join(ROOT, ...rel.split('/'));
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const childRel = `${rel}/${entry.name}`;
    if (entry.isDirectory()) walkFiles(childRel, pattern, out);
    else if (pattern.test(entry.name)) out.push(childRel);
  }
  return out;
}

function markdownNames(rel) {
  const dir = path.join(ROOT, ...rel.split('/'));
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name.replace(/\.md$/, ''))
    .sort();
}

function skillNames(...roots) {
  const names = new Set();
  for (const rel of roots) {
    const dir = path.join(ROOT, ...rel.split('/'));
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'SKILL.md'))) {
        names.add(entry.name);
      }
    }
  }
  return [...names].sort();
}

function optionalSkillNames() {
  const names = new Set();
  const optionalRoot = path.join(ROOT, 'templates', 'optional', 'skills');
  for (const option of fs.readdirSync(optionalRoot, { withFileTypes: true })) {
    if (!option.isDirectory()) continue;
    for (const rel of ['.claude/skills', '.agents/skills']) {
      const dir = path.join(optionalRoot, option.name, ...rel.split('/'));
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'SKILL.md'))) {
          names.add(entry.name);
        }
      }
    }
  }
  return [...names].sort();
}

function commandSurfaceCommands() {
  return JSON.parse(read('Harness/specs/runtime/command-surface.json')).commands;
}

function extractStringArray(text, name) {
  const match = text.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(match, `${name} array should exist`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]).sort();
}

function numberedStepCount(text) {
  return [...text.matchAll(/^\d+\. /gm)].length;
}

test('wf-update direct command wrappers carry the canonical 9-step flow', () => {
  const files = [
    '.claude/commands/wf-update.md',
    '.opencode/commands/wf-update.md',
    'templates/common/.claude/commands/wf-update.md',
    'templates/common/.opencode/commands/wf-update.md',
  ];
  const bodies = files.map(read);

  for (const [idx, body] of bodies.entries()) {
    assert.equal(numberedStepCount(body), 9, `${files[idx]} should have 9 numbered update steps`);
    for (const marker of [
      '## Cache Discipline',
      'agent.safeApplyCommand',
      '--apply-safe',
      'agent.aiMergeRequired',
      '--accept-local',
      '--accept-merged',
      '--accept-template',
      '--finalize',
      '--manifest-audit',
      '--repair',
      'strict `--apply` only when',
      '## Return',
    ]) {
      assert.match(body, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${files[idx]} missing ${marker}`);
    }
  }

  for (const body of bodies.slice(1)) {
    assert.equal(body, bodies[0], 'wf-update command wrappers should be byte-identical');
  }
});

test('wf-ui direct command wrappers launch CLI without router load', () => {
  const files = [
    '.claude/commands/wf-ui.md',
    '.opencode/commands/wf-ui.md',
    'templates/common/.claude/commands/wf-ui.md',
    'templates/common/.opencode/commands/wf-ui.md',
  ];
  const bodies = files.map(read);

  for (const [idx, body] of bodies.entries()) {
    assert.match(body, /direct command/i, `${files[idx]} should be direct`);
    assert.match(body, /Do not invoke a skill/, `${files[idx]} should not invoke a skill`);
    assert.match(body, /create-harness-vibe-coding wf-ui/, `${files[idx]} should launch the CLI`);
    assert.match(body, /--host 127\.0\.0\.1/, `${files[idx]} should bind loopback`);
    assert.match(body, /--open/, `${files[idx]} should request browser open`);
    assert.match(body, /--detach/, `${files[idx]} should detach the long-running server`);
    assert.doesNotMatch(body, /workflow command/i, `${files[idx]} should not be workflow-routed`);
    assert.doesNotMatch(body, /Load `CLAUDE\.md`/, `${files[idx]} should not preload the router`);
  }

  for (const body of bodies.slice(1)) {
    assert.equal(body, bodies[0], 'wf-ui command wrappers should be byte-identical');
  }

  assert.equal(read('.agents/skills/wf-ui/SKILL.md'), read('.claude/skills/wf-ui/SKILL.md'));
});

test('terminal drawer keeps xterm mounted while minimized', () => {
  const body = read('src/ui/src/components/TerminalDrawer.tsx');
  assert.doesNotMatch(body, /if\s*\(\s*minimized\s*\)\s*{\s*return/, 'minimized terminal must not unmount xterm');
  assert.match(body, /data-testid="terminal-minimized"/, 'minimized restore button should remain targetable');
  assert.match(body, /aria-hidden=\{minimized\}/, 'hidden terminal window should be marked aria-hidden');
  assert.match(body, /visibility:\s*minimized\s*\?\s*'hidden'\s*:\s*'visible'/, 'terminal window should be hidden without unmounting');
});

test('codex update prompts require a frontend choice instead of auto-skip', () => {
  const terminalBody = read('src/ui/src/components/TerminalDrawer.tsx');
  const promptBody = read('src/wf-ui-server/codex-update-prompt.mjs');
  assert.match(terminalBody, /data-testid="codex-update-prompt"/, 'Codex update prompt should be visible in terminal UI');
  assert.match(terminalBody, /data-testid="codex-update-skip-session"/, 'Codex update prompt should expose skip-session choice');
  assert.match(terminalBody, /data-testid="codex-update-skip-version"/, 'Codex update prompt should expose skip-until-next-version choice');
  assert.match(promptBody, /codexUpdatePromptInputForChoice/, 'Codex update choice-to-input mapping should stay explicit');
  assert.doesNotMatch(promptBody, /AUTO_SKIP|auto-skip|autoSkipped/i, 'Codex update prompt should not be silently auto-skipped');
});

test('AC-001 AC-002 AC-003 WF UI terminal shell owns response guards, clipboard, and drops', () => {
  const helperBody = read('src/ui/src/terminalControl.ts');
  const terminalBody = read('src/ui/src/components/TerminalDrawer.tsx');
  const workflowBody = read('src/ui/src/components/WorkflowRoute.tsx');
  const cssBody = read('src/ui/src/index.css');

  assert.match(helperBody, /installTerminalResponseGuards/, 'terminal helper should install xterm parser guards');
  assert.match(helperBody, /SPECIAL_COLOR_QUERY_IDS\s*=\s*\[\s*10\s*,\s*11\s*,\s*12\s*\]/, 'OSC 10/11/12 color query IDs should be registered for interception');
  assert.match(helperBody, /registerOscHandler\(id,\s*swallowQuery\)/, 'OSC color query handlers should be dynamically registered from the ID array');
  assert.match(helperBody, /stripTerminalResponseInput/, 'terminal input fallback should strip known response leaks');
  assert.match(helperBody, /copyTerminalSelection/, 'terminal helper should own copy behavior');
  assert.match(helperBody, /uploadDroppedTerminalFiles/, 'terminal helper should own browser file-drop upload');

  assert.match(terminalBody, /data-testid="terminal-copy-selection"/, 'drawer terminal should expose a copy action');
  assert.match(terminalBody, /data-testid="terminal-paste-clipboard"/, 'drawer terminal should expose a paste action');
  assert.match(terminalBody, /onTerminalDrop/, 'drawer terminal output should accept file drops');
  assert.match(terminalBody, /stripTerminalResponseInput\(data\)/, 'drawer terminal should filter outbound terminal-generated response leaks');

  assert.match(workflowBody, /installTerminalResponseGuards/, 'embedded terminal should install parser guards');
  assert.match(workflowBody, /disableStdin:\s*!live/, 'embedded workflow terminals should be read-only viewers when the node is not live');
  assert.match(workflowBody, /control:attach-mode'[,}]\s*attachMode:\s*true/, 'embedded terminal should support the attach-mode protocol for live nodes');
  assert.match(workflowBody, /cancelled \|\| !live \|\|/, 'embedded terminal attach-mode should be gated behind the live flag');
  assert.match(workflowBody, /handleTerminalDrop\(event\.nativeEvent/, 'embedded workflow terminal should accept controlled file drops');

  assert.match(cssBody, /\.wf-canvas-shell \.xterm/, 'xterm selection should override canvas-wide user-select none');
  assert.match(cssBody, /-webkit-user-select:\s*text/, 'terminal selection should be selectable in WebKit/Chromium');
});

test('agent cleanup controls stay exposed in UI and API surface', () => {
  const cliBody = read('src/index.js');
  const agentsBody = read('src/ui/src/components/AgentsRoute.tsx');
  const settingsBody = read('src/ui/src/components/SettingsRoute.tsx');
  const serverBody = read('src/wf-ui-server/server.mjs');
  const cleanupBody = read('src/wf-ui-server/session-cleanup.mjs');

  assert.match(serverBody, /\/api\/cleanup\/summary/, 'cleanup summary API should remain exposed');
  assert.match(serverBody, /\/api\/cleanup\/prune/, 'cleanup prune API should remain exposed');
  assert.match(cleanupBody, /pruneCleanupTargets/, 'cleanup implementation should keep one explicit prune entry point');
  assert.match(agentsBody, /data-testid="cleanup-panel"/, 'Agent UI should expose a storage cleanup panel');
  assert.match(agentsBody, /data-testid="cleanup-apply"/, 'Agent UI should expose an apply cleanup action');
  assert.match(settingsBody, /stoppedSessionRetentionDays/, 'Settings UI should expose stopped-session retention');
  assert.match(settingsBody, /detachedLogRetentionHours/, 'Settings UI should expose detached log retention');
  assert.match(cliBody, /Harness', '\.temp', 'wf-ui-launch'/, 'detached wf-ui launch logs should default to project-local storage');
  assert.doesNotMatch(cliBody, /mkdtempSync\(path\.join\(os\.tmpdir\(\), 'harness-wf-ui-'\)/, 'detached wf-ui should not default to system temp');
});

test('framework test temp roots stay under Harness/.temp', () => {
  const files = [
    ...walkFiles('tests', /\.(js|mjs)$/),
    ...walkFiles('src/wf-ui-server/__tests__', /\.(js|mjs)$/),
  ].filter(rel => rel !== 'tests/support/temp-root.js');

  const offenders = files.filter(rel => /fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\)/.test(read(rel)));

  assert.deepEqual(offenders, [], `test temp roots must use makeHarnessTempRoot(): ${offenders.join(', ')}`);
  assert.match(read('tests/support/temp-root.js'), /path\.resolve\('Harness', '\.temp'\)/);
  assert.match(read('scripts/check-temp-leak.mjs'), /PROJECT_TEMP_ROOT = path\.resolve\('Harness', '\.temp'\)/);
});

test('AC-007 agents route exposes workflow consistency and PTY resource details', () => {
  const agentsBody = read('src/ui/src/components/AgentsRoute.tsx');
  const typesBody = read('src/ui/src/types.ts');

  assert.match(agentsBody, /data-testid="agents-consistency-panel"/, 'Agents route should show live-session consistency against Workflow');
  assert.match(agentsBody, /data-testid="agents-resource-summary"/, 'Agents route should show aggregate PTY resource usage');
  assert.match(agentsBody, /data-testid="agent-resource-usage"/, 'Agents route should show PTY resource usage per running session');
  assert.match(agentsBody, /Current server live PTYs only/, 'Agents resource summary should state the live-PTY-only sampling scope');
  assert.match(agentsBody, /Stopped sessions/, 'Agents resource summary should distinguish stopped transcript records from live resource sampling');
  assert.match(agentsBody, /formatPercent\(resourceTotals\.cpuPercent, 'unavailable'\)/, 'No-live-PTY aggregate CPU should not display a fake 0.0% sample');
  assert.match(agentsBody, /function isKnownNumber/, 'Agents resource aggregation should not treat null as a known zero');
  assert.match(agentsBody, /value !== null && value !== undefined/, 'Agents resource aggregation should distinguish unknown values from 0');
  assert.match(agentsBody, /memoryBytes|memoryMB/, 'Agents route should render memory/resource estimates when available');
  assert.match(agentsBody, /cpuPercent/, 'Agents route should render CPU estimates when available');
  assert.match(agentsBody, /const live = isLiveStatus\(session\.status\)/, 'Agents resource rows should distinguish live PTYs from stopped session records');
  assert.match(agentsBody, /const cpuText = live \? formatPercent\(resource\.cpuPercent\) : 'unavailable'/, 'Stopped session rows should not show CPU warming');
  assert.match(agentsBody, /ptyProvider/, 'Agents route should keep PTY provider visible');
  assert.match(agentsBody, /wsClientCount/, 'Agents route should keep viewer count visible');
  assert.match(typesBody, /resourceUsage/, 'Session type should include resourceUsage returned by /api/sessions');
  assert.match(typesBody, /cpuPercent/, 'Session resourceUsage type should include CPU usage returned by /api/sessions');
});

test('wf-ui agent control protocol is generated and main-agent gated', () => {
  for (const rel of [
    'Harness/scripts/wf-ui-control.mjs',
    'templates/common/Harness/scripts/wf-ui-control.mjs',
    'Harness/a2a/skills/wf-ui-map.json',
    'templates/common/Harness/a2a/skills/wf-ui-map.json',
  ]) {
    assert.ok(exists(rel), `${rel} should exist`);
  }

  assert.equal(read('Harness/scripts/wf-ui-control.mjs'), read('templates/common/Harness/scripts/wf-ui-control.mjs'));
  assert.equal(read('Harness/a2a/skills/wf-ui-map.json'), read('templates/common/Harness/a2a/skills/wf-ui-map.json'));

  const controlBody = read('Harness/scripts/wf-ui-control.mjs');
  const ptyBody = read('src/wf-ui-server/pty-adapter.mjs');
  const runtimeBody = read('src/wf-ui-server/runtime-detector.mjs');
  const roleGraph = read('Harness/a2a/role-graph.json');
  const templateRoleGraph = read('templates/common/Harness/a2a/role-graph.json');
  const serverBody = read('src/wf-ui-server/server.mjs');

  assert.match(controlBody, /create-agent/, 'wf-ui-control should expose create-agent');
  assert.match(controlBody, /describe/, 'wf-ui-control should expose describe');
  assert.match(controlBody, /HARNESS_WF_UI_TOKEN/, 'wf-ui-control should read the control token env');
  assert.match(controlBody, /HARNESS_WF_UI_READ_TOKEN/, 'wf-ui-control should read the read-only graph token env');
  assert.match(controlBody, /X-Harness-Session-Id/, 'wf-ui-control read-only snapshot calls should identify the actor session');
  assert.match(controlBody, /HARNESS_AGENT_KIND/, 'wf-ui-control should know whether the node is main or subagent');
  assert.match(controlBody, /create or control nodes/, 'subagents should be denied node creation/control');
  assert.match(controlBody, /\$\{text\}\\r/, 'wf-ui-control send-input should submit text with Enter by default');
  assert.match(controlBody, /fromSessionId/, 'wf-ui-control send-input should include actor session metadata for bridge records');
  assert.match(controlBody, /bridge-messages/, 'wf-ui-control should expose bridge message reads');
  assert.match(controlBody, /connectNodes/, 'wf-ui-control should expose graph connection edits for Main Agents');
  assert.match(controlBody, /deleteNode/, 'wf-ui-control should expose stopped node deletion for Main Agents');
  assert.match(ptyBody, /HARNESS_WF_UI_URL/, 'PTY agent env should include the control-plane URL');
  assert.match(ptyBody, /HARNESS_WF_UI_TOKEN/, 'PTY agent env should include the control token for main agents');
  assert.match(ptyBody, /HARNESS_WF_UI_READ_TOKEN/, 'PTY agent env should include a read-only graph token for all managed nodes');
  assert.match(ptyBody, /HARNESS_NODE_HOME/, 'PTY agent env should include the node home directory');
  assert.match(ptyBody, /HARNESS_NODE_INIT/, 'PTY agent env should include the node init file');
  assert.match(ptyBody, /agentKind === 'main'/, 'control token should be scoped to main agents');
  assert.match(serverBody, /validateGraphReadToken/, 'server should accept read-only graph tokens only for snapshot reads');
  assert.match(runtimeBody, /dangerously-skip-permissions/, 'Claude launch should support yolo permissions');
  assert.match(runtimeBody, /dangerously-bypass-approvals-and-sandbox/, 'Codex launch should support bypass mode');
  assert.match(roleGraph, /wf-ui-map/, 'dogfood role graph should advertise wf-ui-map');
  assert.match(templateRoleGraph, /wf-ui-map/, 'template role graph should advertise wf-ui-map');
  assert.match(serverBody, /\/api\/a2a\/snapshot/, 'server should expose workflow graph snapshot to agents');
  assert.match(serverBody, /startWorkflowGraphNode/, 'server should support starting stopped workflow graph session nodes');
  assert.match(serverBody, /\/start\$/, 'server should expose a graph-node start route');
  assert.ok(serverBody.includes("pathname.match(/^\\/api\\/sessions\\/([^/]+)\\/input$/)"), 'server should expose PTY input routing');
  assert.match(serverBody, /writePtyInput\(session\.sessionId, data\)/, 'session input API should write to the attached PTY');
  assert.match(runtimeBody, /initialPrompt/, 'runtime launch args should support CLI-native initial prompts');
  assert.doesNotMatch(serverBody, /function agentBootstrapPrompt/, 'runtime sessions should not inject a default bootstrap prompt into terminal input');
  assert.match(serverBody, /bootstrapMode: 'env-node-init'/, 'runtime sessions should record env/node-init bootstrap mode');
  assert.match(serverBody, /nodeInitMarkdown/, 'runtime sessions should write durable node init files');
  assert.match(serverBody, /Harness\/a2a\/nodes/, 'runtime sessions should allocate per-node homes');
  assert.match(serverBody, /writePtyInputSequence/, 'initial agent input should be submitted as a PTY sequence');
  assert.match(serverBody, /INITIAL_INPUT_FALLBACK_DELAY_MS/, 'initial input should have a delayed fallback for slow TUI startup');
  assert.match(serverBody, /scheduleInitialInput/, 'initial input should wait for PTY output before submission');
  assert.match(serverBody, /HARNESS_NODE_INIT/, 'node init path should be exposed through env-driven bootstrap');
  assert.match(serverBody, /Do not print this file/, 'node init should stay quiet instead of flooding the terminal');
  assert.match(serverBody, /wf-ui-control\.mjs describe/, 'node init file should teach graph inspection');
  assert.match(serverBody, /Subagent must not create nodes/, 'node init file should enforce managed PTY delegation limits');
  assert.match(serverBody, /\$\{command\}\\r\$\{ceoPrompt\.trim\(\)\}\\r/, 'workflow startup should submit CLI input with carriage return');
});

test('AC-001 workflow create-agent panel exposes the new agent vocabulary', () => {
  const workflowBody = read('src/ui/src/components/WorkflowRoute.tsx');

  assert.match(workflowBody, /data-testid="workflow-create-node"/, 'toolbar plus should open the Create Node panel');
  assert.match(workflowBody, /data-testid="workflow-context-menu"/, 'canvas context menu should remain targetable');
  assert.match(workflowBody, /data-testid="workflow-create-node-panel"/, 'Create Node panel should have a stable selector');
  assert.match(workflowBody, /wf-floating-panel/, 'Create Agent panel should use the bounded floating panel style');
  assert.match(workflowBody, /closeTransientPanels/, 'temporary workflow panels should dismiss on pane click or drag');
  assert.match(workflowBody, /data-testid="workflow-agent-kind"/, 'Create Agent panel should expose Main Agent/Subagent kind');
  assert.match(workflowBody, /testId="workflow-agent-runtime"/, 'Create Agent panel should expose runtime selection');
  assert.match(workflowBody, /data-testid="workflow-agent-mode"/, 'Create Agent panel should expose workflow mode selection');
  assert.match(workflowBody, /data-testid="workflow-create-agent-submit"/, 'Create Agent panel should expose an explicit submit action');
  assert.match(workflowBody, /Main Agent/, 'agent vocabulary should say Main Agent');
  assert.match(workflowBody, /Subagent/, 'agent vocabulary should say Subagent');
  assert.doesNotMatch(workflowBody, /data-testid="workflow-add-router"/, 'Router should be absent from the default toolbar');
  assert.doesNotMatch(workflowBody, />\s*\{?t\('New Router'\)\}?\s*</, 'Router should be absent from the default canvas context menu');
});

test('AC-003 AC-004 workflow terminal mode uses explicit attach controls without detached input', () => {
  const workflowBody = read('src/ui/src/components/WorkflowRoute.tsx');
  const cssBody = read('src/ui/src/index.css');

  assert.match(workflowBody, /data-testid="workflow-open-terminal"/, 'card mode should expose Open Terminal');
  assert.match(workflowBody, /data-testid="workflow-back-to-node"/, 'terminal mode should expose Back to Node');
  assert.match(workflowBody, /data-testid="workflow-node-config"/, 'double-click/config flow should expose a node config panel');
  assert.match(workflowBody, /data-testid="workflow-terminal-attach"/, 'terminal mode should expose a real PTY attach region');
  assert.match(workflowBody, /repaintTerminal/, 'terminal mode should refresh xterm after ReactFlow layout changes');
  assert.match(workflowBody, /fallbackQueueRef/, 'HTTP fallback input should be serialized when websocket is not ready');
  assert.match(workflowBody, /scheduleRepaintTerminal/, 'terminal repaint should be animation-frame throttled');
  assert.match(workflowBody, /function ConnectionHandles/, 'workflow nodes should expose shared connection handles');
  assert.match(workflowBody, /Position\.Left/, 'workflow node handles should include left-side connection points');
  assert.match(workflowBody, /Position\.Right/, 'workflow node handles should include right-side connection points');
  assert.match(workflowBody, /const handleSize = 12/, 'workflow connection handles should keep compact constant visual targets after canvas zoom');
  assert.match(workflowBody, /const handleScale = 1 \/ safeZoom/, 'workflow connection handles should counter-scale with canvas zoom');
  assert.match(workflowBody, /connectionMode=\{ConnectionMode\.Loose\}/, 'workflow handles should support bidirectional single-dot connections');
  assert.match(workflowBody, /isConnectableStart[\s\S]*isConnectableEnd/, 'each visible workflow handle should be both a source and a target');
  assert.doesNotMatch(workflowBody, /targetStyle:[\s\S]*sourceStyle:/, 'workflow should not render split source/target handle dots per side');
  assert.match(cssBody, /\.react-flow__handle\.wf-flow-handle[\s\S]*width:\s*1[0-2]px/, 'workflow connection handles should override React Flow defaults');
  assert.match(cssBody, /\.wf-flow \.react-flow__edge-textbg[\s\S]*pointer-events:\s*none/, 'workflow bridge label backgrounds should not block clicks');
  assert.match(cssBody, /\.wf-flow \.react-flow__edge-interaction[\s\S]*cursor:\s*pointer/, 'workflow bridge hit paths should present as clickable');
  assert.match(workflowBody, /window\.addEventListener\('pointermove'/, 'workflow bridge lines should keep dragging after the pointer leaves the SVG stroke');
  assert.match(workflowBody, /onEdgeOffsetChange\?\.\([^)]*id, nextOffset, commit && drag\.moved\)/, 'workflow bridge line drags should commit offset changes only after real movement');
  assert.doesNotMatch(workflowBody, /data-testid="workflow-node-send"/, 'detached Send Here input should be removed');
  assert.doesNotMatch(workflowBody, /data-testid="workflow-route-send"/, 'terminal mode should not route detached draft text');
  assert.doesNotMatch(workflowBody, /\bterminalDrafts\b/, 'terminal mode should not be driven by a detached React text draft');
});

test('workflow selection, minimap dismissal, and bridge transcript panel stay exposed', () => {
  const workflowBody = read('src/ui/src/components/WorkflowRoute.tsx');

  assert.match(workflowBody, /selectedNodeIds/, 'workflow should track multi-node selection');
  assert.match(workflowBody, /workflow-selection-count/, 'workflow toolbar should show selected node count');
  assert.match(workflowBody, /workflow-delete-selected/, 'workflow toolbar should expose bulk delete');
  assert.match(workflowBody, /event\.key === 'Delete' \|\| event\.key === 'Backspace'/, 'workflow should delete selected nodes from keyboard');
  assert.match(workflowBody, /event\.key\.toLowerCase\(\) === 'a'/, 'workflow should support select-all keyboard flow');
  assert.match(workflowBody, /workflow-minimap-close/, 'workflow minimap should be dismissible');
  assert.match(workflowBody, /workflow-bridge-panel/, 'workflow bridge edges should open a transcript panel');
  assert.match(workflowBody, /workflow-bridge-messages/, 'workflow bridge panel should render recorded messages');
  assert.match(workflowBody, /\/api\/a2a\/bridge-messages/, 'workflow bridge panel should read backend bridge records');
  assert.match(workflowBody, /bridgeRelationLabel/, 'workflow edges should display wf-bridge instead of legacy can-communicate text');
});

test('AC-010 AC-011 workflow nodes keep stable visual identity and dotted background', () => {
  const workflowBody = read('src/ui/src/components/WorkflowRoute.tsx');
  const cssBody = read('src/ui/src/index.css');
  const brandBody = read('src/ui/src/runtimeBrand.tsx');

  assert.match(workflowBody, /runtimeAccentColor/, 'workflow nodes should color-code runtime identity');
  assert.match(workflowBody, /agentKindColor/, 'workflow nodes should color-code Main Agent/Subagent identity');
  assert.match(workflowBody, /BackgroundVariant\.Dots/, 'workflow should use a visible canvas dotted background');
  assert.match(brandBody, /label: 'Claude Code'[\s\S]*accent: '#c47738'/, 'Claude runtime should use the Claude amber accent');
  assert.match(brandBody, /key === 'codex'[\s\S]*accent: '#111827'/, 'Codex runtime should use a black-white identity');
  assert.match(brandBody, /key === 'opencode'[\s\S]*accent: '#6b7280'/, 'OpenCode runtime should use a gray identity');
  assert.match(brandBody, /key === 'deepseek'[\s\S]*accent: '#2563eb'/, 'DeepSeek runtime should use a blue identity');
  assert.match(brandBody, /key === 'qwen'[\s\S]*accent: '#1d4ed8'/, 'Qwen runtime should use a blue identity');
  assert.match(workflowBody, /displaySessionStatus\(status\)/, 'Workflow node status should normalize legacy saved records before display');
  assert.match(brandBody, /color: 'var\(--fg\)', fontWeight: 700/, 'Runtime text inside the node should not take over the runtime accent color');
  assert.match(cssBody, /\.wf-flow[\s\S]*radial-gradient/, 'workflow canvas should keep a full-canvas dotted fallback');
  assert.match(cssBody, /scrollbar-thumb/, 'scrollbars should be globally styled');
  assert.doesNotMatch(cssBody, /\.wf-node-card:hover[\s\S]{0,120}border-color/, 'hover should not erase node runtime/kind border colors');
});

test('AC-013 AC-014 AC-015 runtime icons and task STATE visualizer stay exposed', () => {
  const workflowBody = read('src/ui/src/components/WorkflowRoute.tsx');
  const agentsBody = read('src/ui/src/components/AgentsRoute.tsx');
  const tasksBody = read('src/ui/src/components/TaskList.tsx');
  const pickerBody = read('src/ui/src/components/RuntimePicker.tsx');
  const parserBody = read('src/wf-ui-server/task-parser.mjs');

  assert.match(pickerBody, /RuntimeBrandMark/, 'RuntimePicker should render brand icons in the selected value and option list');
  assert.match(workflowBody, /<RuntimePicker[\s\S]*testId="workflow-agent-runtime"/, 'Workflow create-agent runtime picker should show brand icons');
  assert.match(workflowBody, /stripRepeatedAgentRole/, 'Workflow node titles should remove repeated Main Agent/Subagent wording');
  assert.match(workflowBody, /RuntimeBrandMark runtime=\{node\.runtime\}/, 'Workflow node headers should keep runtime brand icons');
  assert.match(agentsBody, /<RuntimePicker[\s\S]*testId="agents-runtime-picker"/, 'Agents launcher runtime picker should show brand icons');
  assert.match(agentsBody, /RuntimeBrandLabel runtime=\{session\.runtime\}/, 'Agents session rows should show runtime brand labels');
  assert.match(tasksBody, /data-testid="task-runtime-icons"/, 'Task rows/inspector should show runtime history icons');
  assert.match(tasksBody, /data-testid="task-state-view-toggle"/, 'Task inspector should let users switch Visual and JSON views');
  assert.match(tasksBody, /useState<StateView>\('visual'\)/, 'Task STATE inspector should default to the visual parsed view');
  assert.match(tasksBody, /useState<string>\('STATE\.json'\)/, 'Task file tab state should use the real STATE.json filename');
  assert.match(tasksBody, /setFileTab\('STATE\.json'\)/, 'Opening a task should keep the STATE.json tab active for the visual/JSON toggle');
  assert.match(tasksBody, /data-testid="task-state-visual"/, 'Task inspector should render parsed STATE.json as visual status');
  assert.match(parserBody, /runtimeHistoryForTask/, 'Task parser should collect runtime history for task-bound terminal sessions');
});

test('AC-006 workflow graph edits are undoable and versioned in durable browser state', () => {
  const workflowBody = read('src/ui/src/components/WorkflowRoute.tsx');

  assert.match(workflowBody, /data-testid="workflow-undo"/, 'workflow should expose an undo action');
  assert.match(workflowBody, /\bindexedDB\b/, 'graph persistence should use IndexedDB or an IndexedDB wrapper');
  assert.match(workflowBody, /schemaVersion|graphSchemaVersion/, 'persisted graph state should carry a schema version');
  assert.match(workflowBody, /undoStack|graphHistory|historyStack/, 'graph mutations should keep undo history');
});

test('workflow nodes keep tactile hover styling', () => {
  const workflowBody = read('src/ui/src/components/WorkflowRoute.tsx');
  const cssBody = read('src/ui/src/index.css');

  assert.match(workflowBody, /className="wf-node-card"/, 'workflow nodes should use a stable visual class');
  assert.match(workflowBody, /data-testid="workflow-create-node"/, 'workflow should expose a canvas node creation action');
  assert.match(workflowBody, /data-testid="workflow-canvas-settings"/, 'workflow canvas settings should be opt-in');
  assert.match(workflowBody, /data-testid="workflow-canvas-config"/, 'workflow canvas config should be a disclosed panel');
  assert.match(workflowBody, /data-testid="workflow-open-terminal"/, 'workflow session nodes should have an explicit terminal mode control');
  assert.match(workflowBody, /data-testid="workflow-node-start"/, 'stopped workflow session nodes should expose a start action');
  assert.match(workflowBody, /data-testid="workflow-node-stop"/, 'workflow session nodes should expose a stop action');
  assert.match(workflowBody, /data-testid="workflow-node-delete"/, 'stopped workflow session nodes should expose a delete action');
  assert.match(workflowBody, /\/api\/a2a\/nodes\/\$\{encodeURIComponent\(graphId\)\}\/start/, 'workflow node start should use the backend graph-node start API');
  assert.match(workflowBody, /\/api\/a2a\/nodes\/\$\{encodeURIComponent\(graphId\)\}/, 'workflow node delete should use the backend graph-node delete API');
  assert.match(workflowBody, /control\?\.canStart/, 'workflow start affordance should use backend control permissions');
  assert.match(workflowBody, /control\?\.canStop/, 'workflow stop affordance should use backend control permissions');
  assert.match(workflowBody, /control\?\.canDelete/, 'workflow delete affordance should use backend control permissions');
  assert.match(workflowBody, /autoStartedMainNodes/, 'workflow entry should automatically try to start stopped Main Agent nodes once');
  assert.match(workflowBody, /isMainAgentNode\(node\)[\s\S]*canStartNode\(node\)/, 'workflow auto-start should target only startable Main Agent nodes');
  assert.match(workflowBody, /invalidateApiCache\('\/api\/a2a\/snapshot'\)/, 'workflow refresh should invalidate the snapshot cache key it reads');
  assert.doesNotMatch(workflowBody, /state\.version > projectState\.version \? state : projectState/, 'browser-local graph state must not override the authoritative server graph');
  assert.match(workflowBody, /data-testid="workflow-node-status"/, 'workflow nodes should expose visible state text');
  assert.match(workflowBody, /\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/input/, 'workflow routed input should use the real session input API');
  assert.match(workflowBody, /data-testid="workflow-open-terminal"[\s\S]*onPointerDown=\{stopEvent\}[\s\S]*data\.onToggleMode\(node\.id\)/, 'card-mode Open Terminal button should not be swallowed by ReactFlow pointer handling');
  assert.match(workflowBody, /from 'motion\/react'/, 'workflow card-to-terminal transition should use Motion spring animation');
  assert.match(workflowBody, /terminalModeKey[\s\S]*fitView\(\{ padding: 0\.2, duration: 260 \}\)/, 'terminal expansion should refit the canvas so controls stay reachable');
  assert.doesNotMatch(workflowBody, /<Panel position="top-left">\s*<aside[\s\S]*?Workflow Control/, 'workflow should not show the legacy left control panel by default');
  assert.match(cssBody, /\.wf-node-card:hover/, 'workflow nodes should deepen shadow on hover');
  assert.match(cssBody, /wf-status-pulse/, 'running workflow nodes should have visible live status feedback');
  assert.match(cssBody, /box-shadow:\s*0 16px 38px/, 'workflow hover shadow should be visibly stronger');
  assert.match(cssBody, /wf-edge-flow/, 'workflow routed edges should expose animated flow feedback');
});

test('ECC /wf wildcard rule keeps direct command exemptions explicit', () => {
  const commands = commandSurfaceCommands();
  const directAliases = commands
    .filter(command => command.classification === 'direct')
    .flatMap(command => command.aliases);
  const workflowAliases = commands
    .filter(command => command.classification === 'workflow')
    .flatMap(command => command.aliases);

  for (const rel of [
    '.claude/rules/ecc/common.md',
    'templates/common/.claude/rules/ecc/common.md',
  ]) {
    const body = read(rel);
    const exemptionLine = body.split(/\r?\n/).find(line => line.includes('excluding')) || '';
    for (const alias of directAliases) {
      assert.ok(exemptionLine.includes(`\`${alias}\``), `${rel} missing direct exemption ${alias}`);
    }
    for (const alias of workflowAliases) {
      assert.equal(exemptionLine.includes(`\`${alias}\``), false, `${rel} incorrectly exempts workflow alias ${alias}`);
    }
    assert.doesNotMatch(body, /When the user explicitly invokes a `\/wf-\*` command, load/);
    assert.match(body, /记住/);
    assert.doesNotMatch(body, /鍚|銆|绂|鈥/);
  }
});

test('wf-remove built-in registries cover generated agents and skills', () => {
  const rootScript = read('Harness/scripts/wf-remove.mjs');
  const templateScript = read('templates/common/Harness/scripts/wf-remove.mjs');
  assert.equal(rootScript, templateScript);

  const agentRegistry = extractStringArray(rootScript, 'BUILT_IN_AGENT_NAMES');
  const skillRegistry = extractStringArray(rootScript, 'BUILT_IN_SKILL_NAMES');
  const commandRegistry = extractStringArray(rootScript, 'BUILT_IN_COMMAND_NAMES');
  const cleanupDirs = extractStringArray(rootScript, 'CLEANUP_DIRS');

  for (const name of markdownNames('templates/common/.claude/agents')) {
    assert.ok(agentRegistry.includes(name), `BUILT_IN_AGENT_NAMES missing ${name}`);
  }

  const commonSkills = skillNames('templates/common/.claude/skills');
  const allSkills = [...new Set([...commonSkills, ...optionalSkillNames()])].sort();
  for (const name of allSkills) {
    assert.ok(skillRegistry.includes(name), `BUILT_IN_SKILL_NAMES missing ${name}`);
    assert.ok(cleanupDirs.includes(`.claude/skills/${name}`), `CLEANUP_DIRS missing .claude/skills/${name}`);
    assert.ok(cleanupDirs.includes(`.agents/skills/${name}`), `CLEANUP_DIRS missing .agents/skills/${name}`);
  }

  for (const command of commandSurfaceCommands()) {
    if (command.surfaces?.claudeCommand || command.surfaces?.opencodeCommand) {
      assert.ok(commandRegistry.includes(command.id), `BUILT_IN_COMMAND_NAMES missing ${command.id}`);
    }
  }
});

test('route-critical template and dogfood files stay byte-identical', () => {
  const pairs = [
    ['CLAUDE.md', 'templates/common/CLAUDE.md'],
    ['.claude/rules/ecc/common.md', 'templates/common/.claude/rules/ecc/common.md'],
    ['Harness/specs/runtime/command-surface.json', 'templates/common/Harness/specs/runtime/command-surface.json'],
    ['.claude/commands/wf-help.md', 'templates/common/.claude/commands/wf-help.md'],
    ['.opencode/commands/wf-help.md', 'templates/common/.opencode/commands/wf-help.md'],
    ['.claude/commands/wf-command-create.md', 'templates/common/.claude/commands/wf-command-create.md'],
    ['.opencode/commands/wf-command-create.md', 'templates/common/.opencode/commands/wf-command-create.md'],
    ['.claude/commands/wf-update.md', 'templates/common/.claude/commands/wf-update.md'],
    ['.opencode/commands/wf-update.md', 'templates/common/.opencode/commands/wf-update.md'],
    ['.claude/commands/wf-ui.md', 'templates/common/.claude/commands/wf-ui.md'],
    ['.opencode/commands/wf-ui.md', 'templates/common/.opencode/commands/wf-ui.md'],
    ['.claude/skills/wf-ui/SKILL.md', 'templates/common/.claude/skills/wf-ui/SKILL.md'],
    ['Harness/specs/runtime/context-loading.md', 'templates/common/Harness/specs/runtime/context-loading.md'],
    ['Harness/scripts/context-budget.mjs', 'templates/common/Harness/scripts/context-budget.mjs'],
    ['Harness/scripts/l2-cache-telemetry.mjs', 'templates/common/Harness/scripts/l2-cache-telemetry.mjs'],
    ['Harness/scripts/wf-remove.mjs', 'templates/common/Harness/scripts/wf-remove.mjs'],
    ['Harness/scripts/sync-host-global.mjs', 'templates/common/Harness/scripts/sync-host-global.mjs'],
    ['Harness/scripts/validate-harness.mjs', 'templates/common/Harness/scripts/validate-harness.mjs'],
    ['Harness/scripts/wf-update-runner.mjs', 'templates/common/Harness/scripts/wf-update-runner.mjs'],
  ];

  for (const [rootRel, templateRel] of pairs) {
    assert.equal(read(rootRel), read(templateRel), `${rootRel} should match ${templateRel}`);
  }
});

test('ownership manifest frameworkOwned paths exist on disk', () => {
  const manifest = JSON.parse(read('Harness/ownership.manifest.json'));
  for (const entry of manifest.frameworkOwned) {
    assert.ok(exists(entry.path), `frameworkOwned path missing: ${entry.path}`);
  }
});

test('Harness spec docs live under categorized specs directories, not root', () => {
  const legacyRootDocs = [
    'ACCEPTANCE_PROTOCOL.md',
    'AGENT_ISOLATION.md',
    'DEBUG_PROTOCOL.md',
    'ECC-GUIDE.md',
    'HARNESS_BRIDGE.md',
    'MEMORY_PROTOCOL.md',
    'SETUP.md',
    'TASK_ARCHIVE.md',
    'TDD-GUIDE.md',
    'WF-AUTO-ANGLES.md',
    'WF-AUTO-SPARK.md',
    'WF-AUTO.md',
    'WF-KERNEL.md',
    'WF-MAX.md',
    'WF-STATE.md',
    'WF.md',
    'agent-workflow.md',
    'context-loading.md',
    'dispatch.md',
    'extension.md',
    'lifecycle.md',
    'subagents.md',
  ];

  for (const name of legacyRootDocs) {
    assert.equal(exists(`Harness/${name}`), false, `dogfood legacy root spec doc exists: Harness/${name}`);
    assert.equal(exists(`templates/common/Harness/${name}`), false, `template legacy root spec doc exists: templates/common/Harness/${name}`);
  }

  const manifest = JSON.parse(read('Harness/ownership.manifest.json'));
  for (const entry of manifest.frameworkOwned) {
    assert.doesNotMatch(entry.path, /^Harness\/[^/]+\.md$/, `frameworkOwned root markdown should not be a spec doc: ${entry.path}`);
  }
});
