import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const skillName = 'wiser-yongding-four-agent-tdd';
const sourceRoot = join(repositoryRoot, 'skills', skillName);
const destinationRoot = join(repositoryRoot, '.codebuddy', 'skills', skillName);
const files = ['SKILL.md', join('evals', 'evals.json')];

for (const relativePath of files) {
  const destination = join(destinationRoot, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(sourceRoot, relativePath), destination);
}

process.stdout.write(`Installed ${skillName} into ${destinationRoot}\n`);
