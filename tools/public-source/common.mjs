import {
  existsSync,
  globSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '../..');

export function toPosix(path) {
  return path.split(sep).join('/');
}

export function normalizeRelPath(path) {
  return toPosix(path).replace(/^\.\//, '').replace(/\/+$/, '');
}

export function parseJsonc(text) {
  const withoutComments = stripJsoncComments(String(text).replace(/^\uFEFF/, ''));
  return JSON.parse(stripJsoncTrailingCommas(withoutComments));
}

export function stripJsoncComments(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === '\n' || ch === '\r') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      } else if (ch === '\n' || ch === '\r') {
        out += ch;
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }

    out += ch;
  }

  if (inBlockComment) {
    throw new Error('Unterminated JSONC block comment');
  }

  return out;
}

export function stripJsoncTrailingCommas(text) {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === ',') {
      let lookahead = i + 1;
      while (lookahead < text.length && /\s/.test(text[lookahead])) {
        lookahead += 1;
      }
      if (text[lookahead] === '}' || text[lookahead] === ']') {
        continue;
      }
    }

    out += ch;
  }

  return out;
}

export function loadJsonc(path) {
  return parseJsonc(readFileSync(path, 'utf8'));
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function stableJson(value) {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}

export function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function sha256File(path) {
  return sha256Text(readFileSync(path));
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    shell: false,
    env: options.env ?? process.env,
  });
  if (result.status !== 0) {
    const printable = [command, ...args].join(' ');
    const stderr = result.stderr ? `\n${result.stderr.trim()}` : '';
    const stdout = result.stdout ? `\n${result.stdout.trim()}` : '';
    throw new Error(
      `${printable} failed with exit code ${result.status ?? 'unknown'}${stderr}${stdout}`,
    );
  }
  return result.stdout ?? '';
}

export function optionalRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    shell: false,
    env: options.env ?? process.env,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export function ensureCleanDir(path, options = {}) {
  const resolved = resolve(path);
  assertSafeOutputPath(resolved, options);

  if (options.preserveGit && existsSync(resolve(resolved, '.git'))) {
    for (const entry of globSync('*', { cwd: resolved, dot: true })) {
      if (entry === '.git') continue;
      rmSync(resolve(resolved, entry), { recursive: true, force: true });
    }
    return;
  }

  rmSync(resolved, { recursive: true, force: true });
  mkdirSync(resolved, { recursive: true });
}

function assertSafeOutputPath(path, options = {}) {
  if (!path || path === '/' || path === realpathSafe(process.cwd())) {
    throw new Error(`Refusing to clean unsafe output path: ${path}`);
  }
  const root = realpathSafe(REPO_ROOT);
  const resolved = realpathSafe(path, { allowMissing: true });
  if (resolved === root || isInside(root, resolved)) {
    throw new Error(`Refusing to clean a path inside the source repository: ${path}`);
  }
  if (options.stagingRepo && existsSync(path)) {
    const gitDir = resolve(path, '.git');
    if (!existsSync(gitDir)) {
      throw new Error(`Staging output path exists but is not a git checkout: ${path}`);
    }
  }
}

export function realpathSafe(path, options = {}) {
  if (existsSync(path)) return realpathSync(path);
  if (!options.allowMissing) return resolve(path);
  const parent = dirname(path);
  if (parent === path) return resolve(path);
  return resolve(realpathSafe(parent, options), relative(parent, path));
}

export function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel && !rel.startsWith('..') && !isAbsolute(rel);
}

export function listFiles(root, options = {}) {
  const ignored = options.ignored ?? [];
  return globSync('**/*', {
    cwd: root,
    dot: true,
    nodir: false,
  })
    .map(normalizeRelPath)
    .filter((path) => path && !ignored.some((pattern) => minimatchPath(path, pattern)))
    .sort();
}

export function minimatchPath(path, pattern) {
  const normalizedPath = normalizeRelPath(path);
  const normalizedPattern = normalizeRelPath(pattern);
  if (!normalizedPattern) return false;

  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }
  if (normalizedPattern.endsWith('/')) {
    const prefix = normalizedPattern.slice(0, -1);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }
  if (normalizedPattern.includes('*')) {
    const escaped = normalizedPattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\0')
      .replace(/\*/g, '[^/]*');
    return new RegExp(`^${escaped.replace(/\0/g, '.*')}$`).test(normalizedPath);
  }
  return normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`);
}

export function findPackageJsons(root) {
  return globSync('**/package.json', {
    cwd: root,
    dot: true,
  })
    .map(normalizeRelPath)
    .filter((path) => !path.includes('/node_modules/') && !path.includes('/dist/'))
    .sort();
}

export function findCargoTomls(root) {
  return globSync('**/Cargo.toml', {
    cwd: root,
    dot: true,
  })
    .map(normalizeRelPath)
    .filter((path) => !path.includes('/target') && !path.includes('/node_modules/'))
    .sort();
}

export function pathExists(root, relPath) {
  return existsSync(resolve(root, relPath));
}

export function isSymlink(path) {
  return lstatSync(path).isSymbolicLink();
}

export function fileSize(path) {
  return statSync(path).size;
}
