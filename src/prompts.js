import * as p from '@clack/prompts';
import pc from 'picocolors';

export async function askProjectName() {
  const name = await p.text({
    message: 'Project name?',
    placeholder: 'my-vibe-project',
    defaultValue: 'my-vibe-project',
    validate(value) {
      if (!value.trim()) return 'Project name is required';
      if (!/^[a-zA-Z0-9_-]+$/.test(value)) return 'Only letters, numbers, hyphens, and underscores allowed';
      return;
    },
  });

  if (p.isCancel(name)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  return name.trim();
}

export async function askTargetDir(projectName) {
  const dir = await p.text({
    message: 'Target directory?',
    placeholder: `./${projectName}`,
    defaultValue: `./${projectName}`,
    validate(value) {
      if (!value.trim()) return 'Directory is required';
      return;
    },
  });

  if (p.isCancel(dir)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  return dir.trim();
}

export async function askConflictPolicy(scan) {
  const reason = scan.hasHarness
    ? 'Target already has Harness/. Choose how to handle existing files.'
    : 'Target is not empty. Choose how to handle existing files.';

  const policy = await p.select({
    message: reason,
    initialValue: 'skip',
    options: [
      { value: 'skip', label: 'Preserve existing files', hint: 'recommended for existing projects' },
      { value: 'fail', label: 'Stop on conflict', hint: 'safest dry-run style behavior' },
      { value: 'backup', label: 'Back up conflicts', hint: 'rename existing files before writing templates' },
      { value: 'overwrite', label: 'Overwrite conflicts', hint: 'destructive' },
    ],
  });

  if (p.isCancel(policy)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  return policy;
}

export async function askOptionalSelections(catalog) {
  const localOptions = catalog.skills.map(skill => ({
    value: skill.id,
    label: skill.title,
    hint: skill.description,
  }));
  const externalOptions = (catalog.externalRecommendations || []).map(item => ({
    value: item.id,
    label: item.title,
    hint: `${item.description} Recommendation only.`,
  }));

  const selectedLocal = localOptions.length
    ? await p.multiselect({
      message: 'Optional local workflows?',
      options: localOptions,
      required: false,
    })
    : [];

  if (p.isCancel(selectedLocal)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  const selectedExternal = externalOptions.length
    ? await p.multiselect({
      message: 'External capability recommendations?',
      options: externalOptions,
      required: false,
    })
    : [];

  if (p.isCancel(selectedExternal)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  return {
    withOptions: selectedLocal,
    externalOptions: selectedExternal,
  };
}
