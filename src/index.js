#!/usr/bin/env node
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { askProjectName, askTargetDir } from './prompts.js';
import { generate } from './generator.js';

// ── CLI flags ──────────────────────────────────────────────
const raw = process.argv.slice(2);
const flags = new Set(raw.filter(a => a.startsWith('-')));
const has = name => flags.has(name) || flags.has(`--${name}`);
const showHelp = has('h') || has('help');
const skipPrompts = has('y') || has('yes');

if (showHelp) {
  console.log('');
  console.log('  create-harness-vibe-coding');
  console.log('');
  console.log('  Usage:');
  console.log('    npx create-harness-vibe-coding@latest [project-name] [target-dir] [flags]');
  console.log('');
  console.log('  Arguments:');
  console.log('    project-name   Name for the new project (default: my-vibe-project)');
  console.log('    target-dir     Directory to create the project in (default: ./<project-name>)');
  console.log('');
  console.log('  Flags:');
  console.log('    -y, --yes      Skip all prompts, use defaults or provided args');
  console.log('    -h, --help     Show this help');
  console.log('');
  console.log('  Examples:');
  console.log('    npx create-harness-vibe-coding@latest');
  console.log('    npx create-harness-vibe-coding@latest -y');
  console.log('    npx create-harness-vibe-coding@latest my-project');
  console.log('    npx create-harness-vibe-coding@latest my-project ./dist/my-project -y');
  console.log('');
  process.exit(0);
}

// Positional args (non-flag)
const positional = raw.filter(a => !a.startsWith('-'));
const argName = positional[0];
const argDir = positional[1];

const DEFAULT_NAME = 'my-vibe-project';

console.log('');
console.log(pc.magenta('╔══════════════════════════════════════════╗'));
console.log(pc.magenta('║   create-harness-vibe-coding             ║'));
console.log(pc.magenta('║   0-1 Product Harness Scaffold           ║'));
console.log(pc.magenta('╚══════════════════════════════════════════╝'));
console.log('');

let projectName, targetDir;

// Non-interactive: positionals provided OR -y/--yes flag set
if (argName || skipPrompts) {
  projectName = argName || DEFAULT_NAME;
  targetDir = argDir || `./${projectName}`;

  console.log(pc.dim('────────────────────────────────────────────'));
  console.log(`  Project     ${pc.green(projectName)}`);
  console.log(`  Directory   ${pc.green(targetDir)}`);
  console.log(`  Creates     ${pc.cyan('CLAUDE.md, docs/harness/PLAN.md, docs/, scripts/, .claude/, SETUP.md, tests/')}`);
  if (skipPrompts) {
    console.log(`  Mode        ${pc.dim('non-interactive (-y)')}`);
  }
  console.log(pc.dim('────────────────────────────────────────────'));
  console.log('');

  const result = generate({ projectName, targetDir });
  printResult(result, targetDir);
} else {
  // Interactive mode
  try {
    projectName = await askProjectName();
  } catch {
    projectName = 'my-vibe-project';
    console.log(pc.dim(`  Project: ${projectName} (default)`));
  }

  try {
    targetDir = await askTargetDir(projectName);
  } catch {
    targetDir = `./${projectName}`;
    console.log(pc.dim(`  Directory: ${targetDir} (default)`));
  }

  console.log('');
  console.log(pc.dim('────────────────────────────────────────────'));
  console.log(`  Project     ${pc.green(projectName)}`);
  console.log(`  Directory   ${pc.green(targetDir)}`);
  console.log(`  Creates     ${pc.cyan('CLAUDE.md, docs/harness/PLAN.md, docs/, scripts/, .claude/, SETUP.md, tests/')}`);
  console.log(pc.dim('────────────────────────────────────────────'));
  console.log('');

  let proceed = true;
  try {
    proceed = await p.confirm({
      message: 'Confirm generation?',
      initialValue: true,
    });
    if (p.isCancel(proceed)) proceed = false;
  } catch {
    proceed = true;
  }

  if (!proceed) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  console.log('');
  const result = generate({ projectName, targetDir });
  printResult(result, targetDir);
}

function printResult(result, targetDir) {
  if (result.success) {
    console.log(pc.green(`\nProject created: ${result.created.length} files\n`));

    console.log(pc.bold('Next steps:'));
    console.log(`  ${pc.cyan(`cd ${targetDir}`)}`);
    console.log(`  ${pc.cyan('claude')}                          # Start Claude Code`);
    console.log(`  Tell Claude: "${pc.yellow('Read SETUP.md. Bootstrap this project from idea to first vertical slice.')}"`);
    console.log('');
    console.log(pc.dim('  SETUP.md is temporary. Delete it after initialization.'));
    console.log('');

    if (result.errors.length > 0) {
      console.log(pc.red(`\n${result.errors.length} warning(s):`));
      for (const err of result.errors) {
        console.log(pc.red(`  - ${err}`));
      }
    }
  } else {
    console.log(pc.red('\nGeneration failed:'));
    for (const err of result.errors) {
      console.log(pc.red(`  - ${err}`));
    }
    process.exit(1);
  }
}
