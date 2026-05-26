import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const KERNEL_INTERNAL_SPECIFIER = ['@mog-sdk', 'kernel', 'internal'].join('/');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

const TEXT_EFFECT_BOUNDARY_PATHS = [
  'src/actions/handlers/text-effects.ts',
  'src/components/text-effects',
  'src/chrome/toolbar/tabs/TextEffectsFormatTab.tsx',
  'src/coordinator/mutations',
] as const;

function isSourceFile(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(filePath)) && !filePath.endsWith('.d.ts');
}

function collectSourceFiles(entryPath: string): string[] {
  if (!existsSync(entryPath)) {
    throw new Error(`TextEffect boundary path does not exist: ${toAppRelative(entryPath)}`);
  }

  const stat = statSync(entryPath);
  if (stat.isFile()) {
    return isSourceFile(entryPath) ? [entryPath] : [];
  }

  return readdirSync(entryPath)
    .flatMap((entry) => collectSourceFiles(resolve(entryPath, entry)))
    .sort();
}

function hasKernelInternalImport(source: string): boolean {
  return (
    source.includes(`'${KERNEL_INTERNAL_SPECIFIER}'`) ||
    source.includes(`"${KERNEL_INTERNAL_SPECIFIER}"`)
  );
}

function toAppRelative(filePath: string): string {
  return relative(APP_ROOT, filePath).replaceAll('\\', '/');
}

describe('TextEffect kernel boundary', () => {
  it('keeps TextEffect app code off the kernel internal barrel', () => {
    const files = TEXT_EFFECT_BOUNDARY_PATHS.flatMap((entry) =>
      collectSourceFiles(resolve(APP_ROOT, entry)),
    );

    const violations = files
      .filter((file) => hasKernelInternalImport(readFileSync(file, 'utf8')))
      .map(toAppRelative);

    expect(violations).toEqual([]);
  });

  it('does not keep a duplicate app-side TextEffect mutation module', () => {
    expect(existsSync(resolve(APP_ROOT, 'src/coordinator/mutations/text-effects.ts'))).toBe(false);
  });
});
