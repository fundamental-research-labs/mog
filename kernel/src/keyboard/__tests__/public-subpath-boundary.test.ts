import { readFileSync } from 'node:fs';

describe('@mog-sdk/kernel/keyboard public boundary', () => {
  it('declares a first-class package subpath export', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));

    expect(pkg.exports['./keyboard']).toEqual({
      types: './dist/keyboard/index.d.ts',
      development: './src/keyboard/index.ts',
      import: './dist/keyboard/index.js',
    });
  });

  it('does not keep keyboard exports on the internal barrel', () => {
    const internalSource = readFileSync(new URL('../../internal.ts', import.meta.url), 'utf8');

    expect(internalSource).not.toMatch(/['"]\.\/keyboard(?:\/index)?['"]/);
    expect(internalSource).not.toMatch(/\bKeyboardEventProcessor\b/);
    expect(internalSource).not.toMatch(/\bShortcutMatcher\b/);
  });

  it('does not expose keyboard from the broad root barrel', () => {
    const rootSource = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8');

    expect(rootSource).not.toMatch(/['"]\.\/keyboard(?:\/index)?['"]/);
    expect(rootSource).not.toMatch(/\bKeyboardEventProcessor\b/);
    expect(rootSource).not.toMatch(/\bShortcutMatcher\b/);
  });
});
