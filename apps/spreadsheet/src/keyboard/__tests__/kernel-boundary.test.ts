import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCE_ROOT = resolve(APP_ROOT, 'src');
const KERNEL_INTERNAL_SPECIFIER = ['@mog-sdk', 'kernel', 'internal'].join('/');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

const KEYBOARD_BOUNDARY_PATHS = [
  'src/keyboard',
  'src/components/keyboard',
  'src/dialogs/settings/KeyboardShortcutsDialog.tsx',
  'src/infra/state/keyboard-settings-store.ts',
  'src/systems/input/keyboard',
  'src/systems/input/input-system.ts',
  'src/utils/platform.ts',
  'src/views/calendar/CalendarViewAdapter.ts',
  'src/views/gallery/GalleryViewAdapter.ts',
  'src/views/gallery/components/GalleryCard.tsx',
  'src/views/kanban/components/KanbanBoard.tsx',
  'src/views/timeline/TimelineView.tsx',
  'src/views/timeline/TimelineViewAdapter.ts',
] as const;

const KEYBOARD_SYMBOLS = new Set([
  'KeyboardEventProcessor',
  'ShortcutMatcher',
  'createTestKeyboardInput',
  'isModifierKey',
  'createModifierState',
  'emptyModifierState',
  'getActiveModifiers',
  'isModifierKeyCode',
  'isPhysicalKeyCode',
  'isRegisterTransitionKey',
  'modifierStatesEqual',
  'classifyInput',
  'hasCommandModifier',
  'hasExactModifiers',
  'hasNoModifiers',
  'hasPlatformCommandModifier',
  'PRIORITY_ORDER',
  'getPriorityValue',
  'altBinding',
  'binding',
  'bindingMatches',
  'bindingsEqual',
  'crossPlatformBinding',
  'extractCharacterFromCode',
  'inferMatchBy',
  'macSpecificBinding',
  'parseBinding',
  'platformBindings',
  'resolveBinding',
  'serializeBinding',
  'serializeBindingByKey',
  'universalBinding',
  'PartialTestKeyboardInput',
  'ClassifiedInput',
  'KeyboardInput',
  'KeyboardInputType',
  'ModifierState',
  'PhysicalKeyCode',
  'Platform',
  'RegisterTransitionKeyCode',
  'ShortcutMatchDetailedResult',
  'ChordMatchResult',
  'PendingShortcut',
  'BrowserConflict',
  'BrowserConflictPolicy',
  'ChordFollowOn',
  'KeyboardShortcut',
  'ModifierKey',
  'MuscleMemoryLevel',
  'PhysicalKeyBinding',
  'PlatformKeyBindings',
  'ShortcutCategory',
  'ShortcutContext',
  'ShortcutHandler',
  'ShortcutMatchResult',
  'ShortcutPriority',
  'ShortcutRegistry',
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSourceFile(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(filePath)) && !filePath.endsWith('.d.ts');
}

function collectSourceFiles(entryPath: string): string[] {
  if (!existsSync(entryPath)) {
    throw new Error(`Keyboard boundary path does not exist: ${toAppRelative(entryPath)}`);
  }

  const stat = statSync(entryPath);
  if (stat.isFile()) {
    return isSourceFile(entryPath) ? [entryPath] : [];
  }

  return readdirSync(entryPath)
    .flatMap((entry) => collectSourceFiles(resolve(entryPath, entry)))
    .sort();
}

function stripImportComments(importList: string): string {
  return importList.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
}

function getKernelInternalNamedImports(source: string): string[] {
  const pattern = new RegExp(
    `(?:import|export)(?:\\s+type)?\\s*\\{([\\s\\S]*?)\\}\\s*from\\s*['"]${escapeRegExp(
      KERNEL_INTERNAL_SPECIFIER,
    )}['"]`,
    'g',
  );
  const imported = new Set<string>();

  for (const match of source.matchAll(pattern)) {
    const importList = stripImportComments(match[1] ?? '');
    for (const specifier of importList.split(',')) {
      const importedName = specifier
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (importedName) {
        imported.add(importedName);
      }
    }
  }

  return [...imported].sort();
}

function getKernelInternalNamespaceAliases(source: string): string[] {
  const pattern = new RegExp(
    `import(?:\\s+type)?\\s+\\*\\s+as\\s+(\\w+)\\s+from\\s*['"]${escapeRegExp(
      KERNEL_INTERNAL_SPECIFIER,
    )}['"]`,
    'g',
  );
  return [...source.matchAll(pattern)]
    .map((match) => match[1])
    .filter(Boolean)
    .sort();
}

function getKernelInternalKeyboardSymbols(source: string): string[] {
  const symbols = new Set(
    getKernelInternalNamedImports(source).filter((name) => KEYBOARD_SYMBOLS.has(name)),
  );

  for (const alias of getKernelInternalNamespaceAliases(source)) {
    const symbolPattern = new RegExp(
      `\\b${escapeRegExp(alias)}\\.(${[...KEYBOARD_SYMBOLS].map(escapeRegExp).join('|')})\\b`,
      'g',
    );
    for (const match of source.matchAll(symbolPattern)) {
      const symbol = match[1];
      if (symbol) symbols.add(symbol);
    }
  }

  return [...symbols].sort();
}

function hasKernelInternalImport(source: string): boolean {
  const pattern = new RegExp(
    `(?:from\\s+|import\\()\\s*['"]${escapeRegExp(KERNEL_INTERNAL_SPECIFIER)}['"]`,
  );
  return pattern.test(source);
}

function toAppRelative(filePath: string): string {
  return relative(APP_ROOT, filePath).replaceAll('\\', '/');
}

describe('keyboard kernel boundary', () => {
  it('keeps keyboard-owned app paths off the kernel internal barrel', () => {
    const files = KEYBOARD_BOUNDARY_PATHS.flatMap((entry) =>
      collectSourceFiles(resolve(APP_ROOT, entry)),
    );
    const violations = files
      .filter((file) => hasKernelInternalImport(readFileSync(file, 'utf8')))
      .map(toAppRelative);

    expect(violations).toEqual([]);
  });

  it('does not import keyboard symbols from the kernel internal barrel anywhere in app source', () => {
    const violations = collectSourceFiles(SOURCE_ROOT)
      .map((file) => {
        const imported = getKernelInternalKeyboardSymbols(readFileSync(file, 'utf8'));
        return { file: toAppRelative(file), imported };
      })
      .filter(({ imported }) => imported.length > 0);

    expect(violations).toEqual([]);
  });
});
