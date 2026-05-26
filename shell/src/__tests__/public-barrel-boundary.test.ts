import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SHELL_ROOT = process.cwd();
const ROOT_BARREL = resolve(SHELL_ROOT, 'src/index.ts');
const KERNEL_INTERNAL_SPECIFIER = ['@mog-sdk', 'kernel', 'internal'].join('/');

describe('shell public barrel boundaries', () => {
  it('does not expose kernel internal friend APIs from the root barrel', () => {
    const source = readFileSync(ROOT_BARREL, 'utf8');

    expect(source).not.toContain(KERNEL_INTERNAL_SPECIFIER);
  });
});
