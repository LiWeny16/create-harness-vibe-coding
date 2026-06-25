import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
const TEMPLATES_DIR = path.resolve(__dirname, '..', 'templates', 'common');
const OPTIONAL_DIR = path.resolve(__dirname, '..', 'templates', 'optional');
const OPTIONAL_CATALOG = path.join(OPTIONAL_DIR, 'catalog.json');
const VALID_CONFLICT_POLICIES = new Set(['fail', 'skip', 'backup', 'overwrite']);
const EMPTY_DIRS = [
  '.claude/hooks',
  'tests',
];

function harnessDest(file) {
  if (file === '.harness-version') return 'Harness/.harness-version';
  if (file === 'SETUP.md') return 'Harness/SETUP.md';
  if (file === 'MEMORY.md') return 'Harness/MEMORY.md';
  if (file === 'scripts/validate-harness.mjs') return 'Harness/scripts/validate-harness.mjs';
  if (file.startsWith('memory/')) return `Harness/${file}`;
  if (file === 'docs/README.md') return 'Harness/README.md';
  if (file.startsWith('docs/harness/')) return file.replace(/^docs\/harness\//, 'Harness/');
  if (file.startsWith('docs/research/')) return file.replace(/^docs\/research\//, 'Harness/research/');
  if (file.startsWith('docs/domain/')) return file.replace(/^docs\/domain\//, 'Harness/domain/');
  if (file.startsWith('docs/features/')) return file.replace(/^docs\/features\//, 'Harness/features/');
  if (file.startsWith('docs/workflows/')) return file.replace(/^docs\/workflows\//, 'Harness/workflows/');
  if (file.startsWith('docs/tasks/')) return file.replace(/^docs\/tasks\//, 'Harness/tasks/');
  return file;
}

/**
 * Replace {{vars}} in file contents.
 */
function renderTemplate(src, vars) {
  let content = fs.readFileSync(src, 'utf-8');

  for (const [key, value] of Object.entries(vars)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }

  return content;
}

/**
 * Walk a directory and return relative paths of all files.
 */
function walkFiles(dir, base = dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, base));
    } else {
      results.push(path.relative(base, full));
    }
  }

  return results;
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

export function getOptionalCatalog() {
  if (!fs.existsSync(OPTIONAL_CATALOG)) {
    return { skills: [], presets: {} };
  }

  return JSON.parse(fs.readFileSync(OPTIONAL_CATALOG, 'utf-8'));
}

function normalizeOptionList(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter(Boolean)
    .flatMap(item => String(item).split(','))
    .map(item => item.trim())
    .filter(Boolean);
}

function resolveOptionalSelection({ withOptions = [], withoutOptions = [], preset = undefined }) {
  const catalog = getOptionalCatalog();
  const skillsById = new Map(catalog.skills.map(skill => [skill.id, skill]));
  const selected = [];
  const errors = [];

  if (preset) {
    if (!catalog.presets[preset]) {
      errors.push(`Unknown preset "${preset}". Run --list-options to see available presets.`);
    } else {
      selected.push(...catalog.presets[preset]);
    }
  }

  selected.push(...normalizeOptionList(withOptions));

  const ids = [...new Set(selected)];
  const withoutIds = [...new Set(normalizeOptionList(withoutOptions))];
  for (const id of ids) {
    if (!skillsById.has(id)) {
      errors.push(`Unknown optional skill "${id}". Run --list-options to see available options.`);
    }
  }
  for (const id of withoutIds) {
    if (!skillsById.has(id)) {
      errors.push(`Unknown optional skill in --without "${id}". Run --list-options to see available options.`);
    }
  }

  const withoutSet = new Set(withoutIds);
  const selectedIds = ids.filter(id => !withoutSet.has(id));

  return {
    catalog,
    selectedSkills: errors.length ? [] : selectedIds.map(id => skillsById.get(id)),
    errors,
  };
}

function createCoreFileSpecs() {
  const specs = walkFiles(TEMPLATES_DIR)
    .map(file => normalizePath(file))
    .sort()
    .map(file => ({
      dest: harnessDest(file),
      src: path.join(TEMPLATES_DIR, ...file.split('/')),
      type: 'common',
    }));

  specs.push({ dest: 'tests/.gitkeep', src: undefined, type: 'empty' });
  return specs;
}

function createOptionalFileSpecs(selectedSkills) {
  const specs = [];

  for (const skill of selectedSkills) {
    for (const fileRoot of skill.files) {
      const absRoot = path.join(OPTIONAL_DIR, ...fileRoot.split('/'));
      for (const file of walkFiles(absRoot).map(normalizePath).sort()) {
        specs.push({
          dest: harnessDest(file),
          src: path.join(absRoot, ...file.split('/')),
          type: 'optional',
          skillId: skill.id,
        });
      }
    }
  }

  return specs;
}

function duplicateDests(fileSpecs) {
  const seen = new Set();
  const duplicates = new Set();

  for (const spec of fileSpecs) {
    if (seen.has(spec.dest)) {
      duplicates.add(spec.dest);
    } else {
      seen.add(spec.dest);
    }
  }

  return [...duplicates].sort();
}

function createPlan(resolvedDir, fileSpecs) {
  const plan = {
    create: [],
    skip: [],
    overwrite: [],
    backup: [],
    conflict: [],
    mkdir: [],
  };

  const fileSet = new Set(fileSpecs.map(spec => spec.dest));

  const dirSet = new Set(['.']);
  for (const file of fileSet) {
    let dir = path.posix.dirname(file);
    while (dir && dir !== '.') {
      dirSet.add(dir);
      dir = path.posix.dirname(dir);
    }
  }
  for (const dir of EMPTY_DIRS) {
    dirSet.add(dir);
  }

  for (const dir of [...dirSet].sort()) {
    const absDir = dir === '.'
      ? resolvedDir
      : path.join(resolvedDir, ...dir.split('/'));
    if (fs.existsSync(absDir)) {
      if (!fs.statSync(absDir).isDirectory()) {
        plan.conflict.push(dir === '.' ? './' : `${dir}/`);
      }
    } else {
      plan.mkdir.push(dir === '.' ? './' : `${dir}/`);
    }
  }

  return plan;
}

function addFileActions(plan, fileSpecs, resolvedDir, onConflict) {
  for (const { dest: file } of fileSpecs) {
    const destPath = path.join(resolvedDir, ...file.split('/'));

    if (!fs.existsSync(destPath)) {
      plan.create.push(file);
      continue;
    }

    if (fs.statSync(destPath).isDirectory()) {
      if (onConflict === 'skip') {
        plan.skip.push(file);
      } else {
        plan.conflict.push(file);
      }
      continue;
    }

    if (onConflict === 'skip') {
      plan.skip.push(file);
    } else if (onConflict === 'backup') {
      plan.backup.push(file);
    } else if (onConflict === 'overwrite') {
      plan.overwrite.push(file);
    } else {
      plan.conflict.push(file);
    }
  }
}

function createSummary(plan, { noWrites = false } = {}) {
  return {
    created: noWrites ? 0 : plan.create.length,
    skipped: noWrites ? 0 : plan.skip.length,
    overwritten: noWrites ? 0 : plan.overwrite.length,
    backedUp: noWrites ? 0 : plan.backup.length,
    conflicts: plan.conflict.length,
    mkdir: noWrites ? 0 : plan.mkdir.length,
  };
}

function nextBackupPath(destPath) {
  const first = `${destPath}.harness-backup`;
  if (!fs.existsSync(first)) {
    return first;
  }

  for (let index = 1; ; index += 1) {
    const candidate = `${first}.${index}`;
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
  }
}

function registerOptionalContent(file, content, selectedSkills) {
  if (!selectedSkills.length) return content;

  if (file === 'Harness/MEMORY.md') {
    const lines = selectedSkills.map(skill => (
      `- [${skill.id}](../.claude/skills/${skill.id}/SKILL.md) - ${skill.description} Workflow: [workflows/${skill.id}.md](workflows/${skill.id}.md)`
    ));
    return content.replace(
      'Stack-specific skills can be added after the product shape is known.',
      `Installed optional skills:\n\n${lines.join('\n')}\n\nStack-specific skills can be added after the product shape is known.`,
    );
  }

  if (file === 'Harness/README.md') {
    const lines = selectedSkills.map(skill => (
      `- [${skill.title}](workflows/${skill.id}.md) - ${skill.description}`
    ));
    return `${content.trimEnd()}\n\n## Installed Optional Workflows\n\n${lines.join('\n')}\n`;
  }

  return content;
}

function registrationWarnings(plan, selectedSkills) {
  const warnings = [];

  if (selectedSkills.length) {
    if (plan.skip.includes('Harness/MEMORY.md')) {
      warnings.push('Harness/MEMORY.md was skipped; manually register selected optional skills under #Skills.');
    }
    if (plan.skip.includes('Harness/README.md')) {
      warnings.push('Harness/README.md was skipped; manually register selected optional workflow paths.');
    }
  }

  if (plan.skip.includes('README.md')) {
    warnings.push('README.md was skipped; keep project run, build, test, and git conventions there, not in CLAUDE.md.');
  }
  if (plan.skip.includes('CLAUDE.md') || plan.conflict.includes('CLAUDE.md')) {
    warnings.push('CLAUDE.md already exists; ask the user to confirm refactoring or merging it with the Harness root-entry contract before editing.');
  }
  if (plan.skip.includes('AGENTS.md')) {
    warnings.push('AGENTS.md was skipped; ask for user consent before merging or replacing the project agent entry contract.');
  }

  return warnings;
}

export function generate({
  projectName,
  targetDir,
  dryRun = false,
  onConflict = 'fail',
  withOptions = [],
  withoutOptions = [],
  preset = undefined,
}) {
  const created = [];
  const errors = [];
  const warnings = [];

  // Resolve targetDir relative to cwd
  const resolvedDir = path.resolve(process.cwd(), targetDir);
  const vars = {
    projectName,
    generatorVersion: pkg.version,
    generatedTimestamp: new Date().toISOString(),
  };

  const optional = resolveOptionalSelection({ withOptions, withoutOptions, preset });
  const fileSpecs = [
    ...createCoreFileSpecs(),
    ...createOptionalFileSpecs(optional.selectedSkills),
  ];
  const specsByDest = new Map(fileSpecs.map(spec => [spec.dest, spec]));
  const plan = createPlan(resolvedDir, fileSpecs);
  const duplicateDestinations = duplicateDests(fileSpecs);

  if (!VALID_CONFLICT_POLICIES.has(onConflict)) {
    errors.push(`Unknown conflict policy "${onConflict}". Use fail, skip, backup, or overwrite.`);
    return {
      success: false,
      created,
      errors,
      plan,
      summary: createSummary(plan, { noWrites: true }),
      warnings,
    };
  }

  if (optional.errors.length > 0) {
    errors.push(...optional.errors);
    return {
      success: false,
      created,
      errors,
      plan,
      summary: createSummary(plan, { noWrites: true }),
      warnings,
    };
  }

  if (duplicateDestinations.length > 0) {
    errors.push(`Generation stopped because duplicate template destination(s) were found: ${duplicateDestinations.join(', ')}`);
    return {
      success: false,
      created,
      errors,
      plan,
      summary: createSummary(plan, { noWrites: true }),
      warnings,
    };
  }

  addFileActions(plan, fileSpecs, resolvedDir, onConflict);
  warnings.push(...registrationWarnings(plan, optional.selectedSkills));

  if (dryRun) {
    return {
      success: true,
      created,
      errors,
      plan,
      summary: createSummary(plan),
      warnings,
      dryRun: true,
    };
  }

  if (plan.conflict.length > 0) {
    errors.push(`Generation stopped because ${plan.conflict.length} file conflict(s) were found: ${plan.conflict.join(', ')}`);
    if (plan.conflict.includes('CLAUDE.md')) {
      errors.push('CLAUDE.md already exists. It is the root agent entry contract; ask the user to confirm refactoring or merging it with the Harness entry contract before editing, backing up, or overwriting.');
    }
    return {
      success: false,
      created,
      errors,
      plan,
      summary: createSummary(plan, { noWrites: true }),
      warnings,
    };
  }

  try {
    for (const dir of plan.mkdir) {
      const dirPath = dir === './'
        ? resolvedDir
        : path.join(resolvedDir, ...dir.slice(0, -1).split('/'));
      fs.mkdirSync(dirPath, { recursive: true });
      created.push(dir === './' ? './ (directory)' : `${dir} (directory)`);
    }

    for (const file of plan.backup) {
      const destPath = path.join(resolvedDir, ...file.split('/'));
      fs.renameSync(destPath, nextBackupPath(destPath));
    }

    const writableFiles = [
      ...plan.create,
      ...plan.overwrite,
      ...plan.backup,
    ];

    for (const file of writableFiles) {
      const spec = specsByDest.get(file);
      const destPath = path.join(resolvedDir, ...file.split('/'));
      let content = spec.type === 'empty'
        ? ''
        : renderTemplate(spec.src, vars);
      content = registerOptionalContent(file, content, optional.selectedSkills);

      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, content, 'utf-8');
      created.push(file);
    }

    return {
      success: true,
      created,
      errors,
      plan,
      summary: createSummary(plan),
      warnings,
    };

  } catch (err) {
    errors.push(err.message);
    return {
      success: false,
      created,
      errors,
      plan,
      summary: createSummary(plan),
      warnings,
    };
  }
}
