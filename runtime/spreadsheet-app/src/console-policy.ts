type ConsoleMethod =
  | 'assert'
  | 'count'
  | 'countReset'
  | 'debug'
  | 'dir'
  | 'dirxml'
  | 'error'
  | 'group'
  | 'groupCollapsed'
  | 'groupEnd'
  | 'info'
  | 'log'
  | 'table'
  | 'time'
  | 'timeEnd'
  | 'timeLog'
  | 'trace'
  | 'warn';

const CONSOLE_METHODS: readonly ConsoleMethod[] = [
  'assert',
  'count',
  'countReset',
  'debug',
  'dir',
  'dirxml',
  'error',
  'group',
  'groupCollapsed',
  'groupEnd',
  'info',
  'log',
  'table',
  'time',
  'timeEnd',
  'timeLog',
  'trace',
  'warn',
];

type PatchedMethod = {
  readonly original: unknown;
  readonly silent: (...args: unknown[]) => void;
};

let hiddenRuntimeCount = 0;
let patchedMethods: Partial<Record<ConsoleMethod, PatchedMethod>> = {};

function getConsole(): Console | null {
  const candidate = globalThis.console;
  return candidate && typeof candidate === 'object' ? candidate : null;
}

function installHiddenConsolePolicy(): () => void {
  const target = getConsole();
  if (!target) return () => {};

  if (hiddenRuntimeCount === 0) {
    patchedMethods = {};
    for (const method of CONSOLE_METHODS) {
      if (!(method in target)) continue;

      const silent = () => {};
      patchedMethods[method] = {
        original: target[method],
        silent,
      };
      target[method] = silent as never;
    }
  }

  hiddenRuntimeCount += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    hiddenRuntimeCount = Math.max(0, hiddenRuntimeCount - 1);
    if (hiddenRuntimeCount > 0) return;

    const restoreTarget = getConsole();
    if (restoreTarget) {
      for (const method of CONSOLE_METHODS) {
        const patch = patchedMethods[method];
        if (!patch) continue;
        if (restoreTarget[method] === patch.silent) {
          restoreTarget[method] = patch.original as never;
        }
      }
    }
    patchedMethods = {};
  };
}

export function applySpreadsheetConsolePolicy(
  visibility: 'visible' | 'hidden' | undefined,
): () => void {
  return visibility === 'hidden' ? installHiddenConsolePolicy() : () => {};
}
