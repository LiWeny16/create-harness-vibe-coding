import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

type PermissionMode = 'ask' | 'allow' | 'deny';

const MODES = new Set<PermissionMode>(['ask', 'allow', 'deny']);

export default function piHostGate(pi: ExtensionAPI) {
  let mode: PermissionMode = 'ask';

  pi.registerCommand('harness-permission-mode', {
    description: 'Set the Harness Pi permission mode',
    handler: async (args) => {
      const requested = String(args || '').trim().split(/\s+/)[0] as PermissionMode;
      if (!MODES.has(requested)) throw new Error('permission mode must be ask, allow, or deny');
      mode = requested;
    },
  });

  pi.on('tool_call', async (event, ctx) => {
    if (mode === 'allow') return undefined;
    const tool = String(event.toolName || 'tool');
    const input = event.input && typeof event.input === 'object' ? event.input : {};
    const summary = JSON.stringify(input);
    if (mode === 'deny') {
      return { block: true, reason: `Harness permission mode denies ${tool}` };
    }
    if (!ctx.hasUI) {
      return { block: true, reason: `Harness permission mode requires host approval for ${tool}` };
    }
    try {
      const confirmed = await ctx.ui.confirm(
        `Permission required: ${tool}`,
        summary.length > 1200 ? `${summary.slice(0, 1197)}...` : summary,
      );
      return confirmed ? undefined : { block: true, reason: `Harness host denied ${tool}` };
    } catch {
      return { block: true, reason: `Harness host approval was unavailable for ${tool}` };
    }
  });
}
