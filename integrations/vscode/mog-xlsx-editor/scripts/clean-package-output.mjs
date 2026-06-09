import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await rm(resolve(packageRoot, 'dist/mog-xlsx-editor.vsix'), { force: true });
