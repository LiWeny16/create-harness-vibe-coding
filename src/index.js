#!/usr/bin/env node
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { askProjectName, askTargetDir } from './prompts.js';
import { generate, getOptionalCatalog } from './generator.js';

// ── CLI flags ──────────────────────────────────────────────
const raw = process.argv.slice(2);
const parsed = parseArgs(raw);
const showHelp = parsed.flags.help || parsed.flags.h;
const skipPrompts = parsed.flags.yes || parsed.flags.y;

if (parsed.errors.length > 0) {
  for (const err of parsed.errors) {
    console.error(pc.red(`Error: ${err}`));
  }
  process.exit(1);
}

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
  console.log('    -y, --yes                    Skip all prompts, use defaults or provided args');
  console.log('    -h, --help                   Show this help');
  console.log('    --dry-run                    Print the planned writes without creating files');
  console.log('    --on-conflict <policy>       fail, skip, backup, or overwrite (default: fail)');
  console.log('    --with <id,id>               Add optional local workflow skills');
  console.log('    --without <id,id>            Remove optional workflow skills selected by --preset or --with');
  console.log('    --preset <name>              Add a built-in optional workflow preset');
  console.log('    --list-options               Print optional workflow skills and presets');
  console.log('    --json                       Output machine-readable JSON (use with --dry-run for planning)');
  console.log('');
  console.log('  Examples:');
  console.log('    npx create-harness-vibe-coding@latest');
  console.log('    npx create-harness-vibe-coding@latest -y');
  console.log('    npx create-harness-vibe-coding@latest my-project');
  console.log('    npx create-harness-vibe-coding@latest my-project ./dist/my-project -y');
  console.log('    npx create-harness-vibe-coding@latest legacy ./legacy -y --dry-run');
  console.log('    npx create-harness-vibe-coding@latest legacy ./legacy -y --on-conflict skip');
  console.log('    npx create-harness-vibe-coding@latest web ./web -y --with ts-react-frontend,browser-e2e');
  console.log('    npx create-harness-vibe-coding@latest web ./web -y --preset web-app');
  console.log('    npx create-harness-vibe-coding@latest api ./api -y --preset fullstack --without github-pr-review');
  console.log('');
  process.exit(0);
}

if (parsed.flags.listOptions) {
  printOptions();
  process.exit(0);
}

// Positional args (non-flag)
const positional = parsed.positionals;
const argName = positional[0];
const argDir = positional[1];
const generationOptions = {
  dryRun: Boolean(parsed.flags.dryRun),
  onConflict: parsed.flags.onConflict || 'fail',
  withOptions: parsed.flags.with || [],
  withoutOptions: parsed.flags.without || [],
  preset: parsed.flags.preset,
  json: Boolean(parsed.flags.json),
};

const DEFAULT_NAME = 'my-vibe-project';

// --json: machine-readable output, no prompts, no decorative output
if (generationOptions.json) {
  const projectName = argName || DEFAULT_NAME;
  const targetDir = argDir || `./${projectName}`;
  const result = generate({ projectName, targetDir, ...generationOptions });
  printJsonResult(result);
  // printJsonResult exits with 1 on failure; we only reach here on success
  process.exit(0);
}

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
  console.log(`  Creates     ${pc.cyan('CLAUDE.md, README.md, Harness/PROGRESS.md, Harness/, .claude/, tests/')}`);
  if (generationOptions.dryRun) {
    console.log(`  Mode        ${pc.yellow('dry-run')}`);
  }
  console.log(`  Conflicts   ${pc.cyan(generationOptions.onConflict)}`);
  if (generationOptions.withOptions.length > 0) {
    console.log(`  Optional    ${pc.cyan(generationOptions.withOptions.join(','))}`);
  }
  if (generationOptions.withoutOptions.length > 0) {
    console.log(`  Without     ${pc.cyan(generationOptions.withoutOptions.join(','))}`);
  }
  if (generationOptions.preset) {
    console.log(`  Preset      ${pc.cyan(generationOptions.preset)}`);
  }
  if (skipPrompts) {
    console.log(`  Mode        ${pc.dim('non-interactive (-y)')}`);
  }
  console.log(pc.dim('────────────────────────────────────────────'));
  console.log('');

  const result = generate({ projectName, targetDir, ...generationOptions });
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
  console.log(`  Creates     ${pc.cyan('CLAUDE.md, README.md, Harness/PROGRESS.md, Harness/, .claude/, tests/')}`);
  console.log(`  Conflicts   ${pc.cyan(generationOptions.onConflict)}`);
  console.log(pc.dim('────────────────────────────────────────────'));
  console.log('');

  const preview = generate({ projectName, targetDir, ...generationOptions, dryRun: true });
  if (!preview.success) {
    printResult(preview, targetDir);
  }

  console.log(pc.yellow('Planned changes: no files have been written yet.'));
  printSummary(preview.summary);
  printPlan(preview.plan);
  printWarnings(preview);
  console.log('');

  if (generationOptions.dryRun) {
    process.exit(0);
  }

  let proceed = true;
  try {
    proceed = await p.confirm({
      message: 'Confirm generation with this plan?',
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
  const result = generate({ projectName, targetDir, ...generationOptions });
  printResult(result, targetDir);
}

function printResult(result, targetDir) {
  if (result.success) {
    if (result.dryRun) {
      console.log(pc.yellow('\nDry run: no files or directories were written.'));
      printSummary(result.summary);
      printPlan(result.plan);
      if (result.warnings.length > 0) {
        console.log(pc.yellow('\nWarning(s):'));
        for (const warning of result.warnings) {
          console.log(pc.yellow(`  - ${warning}`));
        }
      }
      console.log('');
      return;
    }

    console.log(pc.green('\nGeneration complete.\n'));
    printSummary(result.summary);

    printWarnings(result);

    console.log(pc.bold('Next steps:'));
    console.log(`  ${pc.cyan(`cd ${targetDir}`)}`);
    console.log(`  ${pc.cyan('claude')}                          # Start Claude Code`);
    console.log(`  Tell Claude: "${pc.yellow('Read Harness/SETUP.md. Bootstrap this project from idea to first vertical slice.')}"`);
    console.log('');
    console.log(pc.dim('  Harness/SETUP.md is temporary. Delete it after initialization.'));
    console.log('');

  } else {
    console.log(pc.red('\nGeneration failed:'));
    for (const err of result.errors) {
      console.log(pc.red(`  - ${err}`));
    }
    process.exit(1);
  }
}

function parseArgs(args) {
  const flags = {
    with: [],
    without: [],
  };
  const positionals = [];
  const errors = [];

  function readValue(flagName, index) {
    const value = args[index + 1];
    if (!value || value.startsWith('-')) {
      errors.push(`${flagName} requires a value`);
      return { value: undefined, nextIndex: index };
    }
    return { value, nextIndex: index + 1 };
  }

  function readEqualsValue(flagName, value) {
    if (!value || value.startsWith('-')) {
      errors.push(`${flagName} requires a value`);
      return undefined;
    }
    return value;
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '-h') {
      flags.h = true;
    } else if (arg === '--help') {
      flags.help = true;
    } else if (arg === '-y') {
      flags.y = true;
    } else if (arg === '--yes') {
      flags.yes = true;
    } else if (arg === '--dry-run') {
      flags.dryRun = true;
    } else if (arg === '--list-options') {
      flags.listOptions = true;
    } else if (arg === '--json') {
      flags.json = true;
    } else if (arg === '--on-conflict') {
      const parsedValue = readValue('--on-conflict', i);
      flags.onConflict = parsedValue.value;
      i = parsedValue.nextIndex;
    } else if (arg.startsWith('--on-conflict=')) {
      flags.onConflict = readEqualsValue('--on-conflict', arg.slice('--on-conflict='.length));
    } else if (arg === '--with') {
      const parsedValue = readValue('--with', i);
      if (parsedValue.value !== undefined) flags.with.push(parsedValue.value);
      i = parsedValue.nextIndex;
    } else if (arg.startsWith('--with=')) {
      const value = readEqualsValue('--with', arg.slice('--with='.length));
      if (value !== undefined) flags.with.push(value);
    } else if (arg === '--without') {
      const parsedValue = readValue('--without', i);
      if (parsedValue.value !== undefined) flags.without.push(parsedValue.value);
      i = parsedValue.nextIndex;
    } else if (arg.startsWith('--without=')) {
      const value = readEqualsValue('--without', arg.slice('--without='.length));
      if (value !== undefined) flags.without.push(value);
    } else if (arg === '--preset') {
      const parsedValue = readValue('--preset', i);
      flags.preset = parsedValue.value;
      i = parsedValue.nextIndex;
    } else if (arg.startsWith('--preset=')) {
      flags.preset = readEqualsValue('--preset', arg.slice('--preset='.length));
    } else if (arg.startsWith('-')) {
      errors.push(`Unknown flag "${arg}"`);
    } else {
      positionals.push(arg);
    }
  }

  return { flags, positionals, errors };
}

function printOptions() {
  const catalog = getOptionalCatalog();

  console.log('');
  console.log(pc.bold('Optional workflow skills:'));
  for (const skill of catalog.skills) {
    console.log(`  ${pc.cyan(skill.id)} - ${skill.description}`);
  }

  console.log('');
  console.log(pc.bold('Presets:'));
  for (const [name, skills] of Object.entries(catalog.presets)) {
    console.log(`  ${pc.cyan(name)} - ${skills.join(', ')}`);
  }
  console.log('');
}

function printSummary(summary) {
  console.log(`  created     ${pc.green(summary.created)}`);
  console.log(`  skipped     ${pc.yellow(summary.skipped)}`);
  console.log(`  backed up   ${pc.cyan(summary.backedUp)}`);
  console.log(`  overwritten ${pc.cyan(summary.overwritten)}`);
  console.log(`  conflicts   ${summary.conflicts > 0 ? pc.red(summary.conflicts) : pc.dim(summary.conflicts)}`);
  console.log(`  directories ${pc.dim(summary.mkdir)}`);
  console.log('');
}

function printPlan(plan) {
  for (const [label, files] of Object.entries(plan)) {
    if (!files.length) continue;
    console.log(`  ${label}:`);
    for (const file of files) {
      console.log(`    - ${file}`);
    }
  }
}

function printWarnings(result) {
  if (!result.warnings.length) return;

  console.log(pc.yellow('\nWarning(s):'));
  for (const warning of result.warnings) {
    console.log(pc.yellow(`  - ${warning}`));
  }
}

function printJsonResult(result) {
  // Remove `created` array from output — it is already in the plan, avoid duplication
  const { created, ...rest } = result;
  console.log(JSON.stringify(rest, null, 2));
  if (!result.success) {
    process.exit(1);
  }
}
