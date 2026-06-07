import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(currentFile), '../../..');
const PRODUCTION_ROOTS = ['kernel/src', 'apps/spreadsheet/src'];
const PIVOT_ERROR_FACTORY_FILE = 'kernel/src/errors/pivot.ts';

interface Violation {
  file: string;
  line: number;
  snippet: string;
  message: string;
}

function sourceFiles(root: string): string[] {
  const absRoot = path.join(REPO, root);
  const out: string[] = [];
  const stack = [absRoot];

  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(REPO, abs);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') {
          continue;
        }
        stack.push(abs);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/\.gen\.ts$/.test(entry.name)) continue;
      out.push(rel);
    }
  }

  return out.sort();
}

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function snippetAt(source: string, index: number): string {
  const start = source.lastIndexOf('\n', index) + 1;
  const end = source.indexOf('\n', index);
  return source.slice(start, end === -1 ? source.length : end).trim();
}

function nextNonWhitespace(source: string, index: number): number {
  let i = index;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  return i;
}

function splitCallArguments(source: string, openParen: number): string[] | null {
  const args: string[] = [];
  let start = openParen + 1;
  let depth = 0;
  let quote: "'" | '"' | '`' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = openParen + 1; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === ')' && depth === 0) {
      const tail = source.slice(start, i).trim();
      if (tail.length > 0) args.push(tail);
      return args;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      continue;
    }
    if (ch === ',' && depth === 0) {
      args.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }

  return null;
}

function hasQualifiedPivotUpdateOptions(arg: string): boolean {
  return (
    /^pivotUpdateOptions\s*\(/.test(arg) ||
    ((/\breason\s*:/.test(arg) || /\breason\b/.test(arg)) &&
      (/\brefreshPolicy\s*:/.test(arg) || /\brefreshPolicy\b/.test(arg)))
  );
}

function collectUpdatePivotViolations(file: string, source: string): Violation[] {
  const violations: Violation[] = [];
  let quote: "'" | '"' | '`' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }

    if (!source.startsWith('.updatePivot', i)) continue;
    const openParen = nextNonWhitespace(source, i + '.updatePivot'.length);
    if (source[openParen] !== '(') continue;

    const args = splitCallArguments(source, openParen);
    const optionsArg = args?.[3];
    if (!args || args.length < 4 || !optionsArg || !hasQualifiedPivotUpdateOptions(optionsArg)) {
      violations.push({
        file,
        line: lineAt(source, i),
        snippet: snippetAt(source, i),
        message: 'PivotBridge.updatePivot call must pass explicit PivotUpdateOptions',
      });
    }
  }

  return violations;
}

function collectPivotKernelErrorViolations(file: string, source: string): Violation[] {
  if (file === PIVOT_ERROR_FACTORY_FILE) return [];

  const violations: Violation[] = [];
  const re = /new\s+KernelError\s*\(\s*(['"])PIVOT_[A-Z0-9_]+\1/g;
  for (const match of source.matchAll(re)) {
    violations.push({
      file,
      line: lineAt(source, match.index ?? 0),
      snippet: snippetAt(source, match.index ?? 0),
      message:
        'PIVOT_* KernelError codes must be constructed through kernel/src/errors/pivot.ts factories',
    });
  }
  return violations;
}

function formatViolations(violations: Violation[]): string {
  return violations.map((v) => `${v.file}:${v.line}: ${v.message} -- ${v.snippet}`).join('\n');
}

describe('pivot update and error contract gates', () => {
  const files = PRODUCTION_ROOTS.flatMap(sourceFiles);

  test('all PivotBridge.updatePivot producers pass explicit reason and refresh policy', () => {
    const violations = files.flatMap((file) =>
      collectUpdatePivotViolations(file, fs.readFileSync(path.join(REPO, file), 'utf8')),
    );

    expect(formatViolations(violations)).toBe('');
  });

  test('PIVOT_* kernel errors are only constructed by typed pivot error factories', () => {
    const violations = files.flatMap((file) =>
      collectPivotKernelErrorViolations(file, fs.readFileSync(path.join(REPO, file), 'utf8')),
    );

    expect(formatViolations(violations)).toBe('');
  });
});
