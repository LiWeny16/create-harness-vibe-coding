// verify.mjs — Assertion helpers for batch tests
let passed = 0, failed = 0, currentScenario = '';

export function scenario(name) { currentScenario = name; }

export function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error(`  FAIL [${currentScenario}]: ${msg}`); }
}

export function assertMode(mode, expectedMode, expectedRole, expectedPhase) {
  assert(mode !== null, `mode file exists`);
  if (!mode) return;
  assert(mode.mode === expectedMode, `mode=${mode.mode}, expected=${expectedMode}`);
  if (expectedRole) assert((mode.agentRole || mode.role) === expectedRole, `role=${mode.agentRole || mode.role}, expected=${expectedRole}`);
  if (expectedPhase) assert(mode.phase === expectedPhase, `phase=${mode.phase}, expected=${expectedPhase}`);
}

export function assertHookBlocked(result, toolName) {
  assert(result.exit === 2, `${toolName} BLOCKED (exit=2)`);
  assert(result.stderr.includes('BLOCK'), `stderr contains BLOCK`);
}

export function assertHookAllowed(result, toolName) {
  assert(result.exit === 0, `${toolName} ALLOWED (exit=0)`);
}

export function assertSessionStartContains(stdout, text) {
  assert(stdout.includes(text), `SessionStart contains "${text}"`);
}

export function summary() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Batch: ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(60)}`);
  return failed > 0 ? 1 : 0;
}
