'use strict';

const { readdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

function collectCheckableFiles(relativeDirectory) {
  const absoluteDirectory = path.join(rootDir, relativeDirectory);
  const entries = readdirSync(absoluteDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(absoluteDirectory, entry.name);
    const relativePath = path.relative(rootDir, absolutePath);

    if (entry.isDirectory()) {
      files.push(...collectCheckableFiles(relativePath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.cjs')) {
      files.push(relativePath);
    }
  }

  return files;
}

const filesToCheck = ['scripts', 'src', 'tests']
  .flatMap((directory) => collectCheckableFiles(directory))
  .sort((left, right) => left.localeCompare(right));

for (const relativePath of filesToCheck) {
  const result = spawnSync(process.execPath, ['--check', path.join(rootDir, relativePath)], {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
