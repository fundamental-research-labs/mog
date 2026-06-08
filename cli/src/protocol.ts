import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export type CliCommand =
  | { kind: 'help' }
  | { kind: 'daemon'; stateKey: string }
  | { kind: 'create'; path: string; name?: string }
  | { kind: 'load'; path: string }
  | { kind: 'execute'; id: string; code?: string; codeFile?: string }
  | { kind: 'commit'; id: string; path?: string }
  | { kind: 'unload'; id: string }
  | { kind: 'list' }
  | { kind: 'shutdown' };

export type DaemonRequest =
  | { method: 'ping' }
  | { method: 'create'; path: string; name?: string }
  | { method: 'load'; path: string }
  | { method: 'execute'; id: string; code: string }
  | { method: 'commit'; id: string; path?: string }
  | { method: 'unload'; id: string }
  | { method: 'list' }
  | { method: 'shutdown' };

export type DaemonResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: { message: string; stack?: string } };

export function parseCliArgs(argv: readonly string[]): CliCommand {
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      return { kind: 'help' };
    case '_daemon': {
      const stateKey = rest[0];
      if (!stateKey) throw new Error('Internal error: _daemon requires a state key.');
      return { kind: 'daemon', stateKey };
    }
    case 'create': {
      return parseCreateCommand(rest);
    }
    case 'load': {
      const path = rest[0];
      if (!path) throw new Error('Usage: mog load <path>');
      return { kind: 'load', path: resolve(path) };
    }
    case 'execute': {
      return {
        kind: 'execute',
        id: requiredOption(rest, '--id', 'Usage: mog execute --id <workbookId> --code <code>'),
        code: optionalOption(rest, '--code'),
        codeFile: optionalOption(rest, '--code-file'),
      };
    }
    case 'commit':
      return {
        kind: 'commit',
        id: requiredOption(rest, '--id', 'Usage: mog commit --id <workbookId> [--path <path>]'),
        path: optionalOption(rest, '--path'),
      };
    case 'unload':
      return {
        kind: 'unload',
        id: requiredOption(rest, '--id', 'Usage: mog unload --id <workbookId>'),
      };
    case 'list':
      return { kind: 'list' };
    case 'shutdown':
      return { kind: 'shutdown' };
    default:
      throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }
}

export function stateKeyForCwd(cwd = process.cwd()): string {
  return createHash('sha256').update(cwd).digest('hex').slice(0, 20);
}

export type DaemonStatePathOptions = {
  env?: Partial<Pick<NodeJS.ProcessEnv, 'MOG_CLI_SOCKET' | 'MOG_CLI_PID'>>;
  platform?: NodeJS.Platform;
  tmpDir?: string;
};

export function socketPathForState(stateKey: string, options: DaemonStatePathOptions = {}): string {
  const env = options.env ?? process.env;
  if (env.MOG_CLI_SOCKET) return env.MOG_CLI_SOCKET;

  const platform = options.platform ?? process.platform;
  if (platform === 'win32') return `\\\\.\\pipe\\mog-${stateKey}`;

  return join(options.tmpDir ?? tmpdir(), `mog-${stateKey}.sock`);
}

export function pidPathForState(stateKey: string, options: DaemonStatePathOptions = {}): string {
  const env = options.env ?? process.env;
  return env.MOG_CLI_PID ?? join(options.tmpDir ?? tmpdir(), `mog-${stateKey}.pid`);
}

export function isNamedPipePath(path: string): boolean {
  return path.startsWith('\\\\.\\pipe\\') || path.startsWith('\\\\?\\pipe\\');
}

export function toJsonSafe(value: unknown): unknown {
  return toJsonSafeInner(value, new WeakSet<object>());
}

export function usage(): string {
  return [
    'Usage:',
    '  mog create <path>',
    '  mog create --name <workbookName> --path <directory>',
    '  mog load <path>',
    '  mog execute --id <workbookId> --code <code>',
    '  mog execute --id <workbookId> --code-file <path>',
    '  mog commit --id <workbookId> [--path <path>]',
    '  mog unload --id <workbookId>',
    '  mog list',
    '',
    'Execute code runs inside the Mog daemon with these bindings:',
    '  wb, workbook, ws, activeSheet, api, Utils, console',
    '',
    'Example:',
    '  mog execute --id abc --code "await ws.setCell(\\"A1\\", 42); return ws.getValue(\\"A1\\");"',
  ].join('\n');
}

function parseCreateCommand(args: readonly string[]): Extract<CliCommand, { kind: 'create' }> {
  const directPath = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
  const name = optionalOption(args, '--name');
  const directory = optionalOption(args, '--path');

  if (directPath) {
    if (name || directory) {
      throw new Error(
        'Usage: mog create <path>\n       mog create --name <workbookName> --path <directory>',
      );
    }
    return {
      kind: 'create',
      path: resolve(directPath),
      name: workbookNameFromPath(directPath),
    };
  }

  if (!name || !directory) {
    throw new Error(
      'Usage: mog create <path>\n       mog create --name <workbookName> --path <directory>',
    );
  }

  return {
    kind: 'create',
    path: resolve(directory, workbookFileName(name)),
    name: workbookNameFromPath(name),
  };
}

function requiredOption(args: readonly string[], name: string, errorMessage: string): string {
  const value = optionalOption(args, name);
  if (!value) throw new Error(errorMessage);
  return value;
}

function optionalOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function workbookFileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Workbook name must not be empty.');
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error('Workbook name must not contain path separators.');
  }
  return trimmed.toLowerCase().endsWith('.xlsx') ? trimmed : `${trimmed}.xlsx`;
}

function workbookNameFromPath(path: string): string {
  return basename(path).replace(/\.xlsx$/i, '');
}

function toJsonSafeInner(value: unknown, seen: WeakSet<object>): unknown {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') {
    return `[Function ${(value as { name?: string }).name || 'anonymous'}]`;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) {
    return {
      type: 'Uint8Array',
      length: value.byteLength,
      base64: Buffer.from(value).toString('base64'),
    };
  }
  if (Array.isArray(value)) return value.map((entry) => toJsonSafeInner(entry, seen));
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, entry]) => [String(key), toJsonSafeInner(entry, seen)]),
    );
  }
  if (value instanceof Set) return [...value].map((entry) => toJsonSafeInner(entry, seen));
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toJsonSafeInner(entry, seen)]),
    );
  }
  return String(value);
}
