#!/usr/bin/env node

import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const SKIP_SEGMENTS = new Set([
  '.git',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'target',
  'target-native',
  'target-wasm',
]);

function toRepoPath(absPath) {
  return relative(ROOT, absPath).replaceAll('\\', '/');
}

function extensionOf(path) {
  const match = path.match(/(\.[^.\/]+)$/);
  return match ? match[1] : '';
}

function isDeclarationFile(path) {
  return /\.d\.[cm]?ts$/.test(path);
}

function shouldSkipPath(relPath) {
  if (relPath === '.claude/worktrees' || relPath.startsWith('.claude/worktrees/')) return true;
  return relPath.split('/').some((segment) => SKIP_SEGMENTS.has(segment));
}

function walk(dir, results = []) {
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir).sort((a, b) => a.localeCompare(b));
  for (const entry of entries) {
    const absPath = join(dir, entry);
    const relPath = toRepoPath(absPath);
    if (shouldSkipPath(relPath)) continue;

    let stat;
    try {
      stat = lstatSync(absPath);
    } catch {
      continue;
    }

    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      walk(absPath, results);
      continue;
    }
    if (!stat.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(extensionOf(relPath))) continue;
    if (isDeclarationFile(relPath)) continue;
    results.push(absPath);
  }
  return results;
}

function loadCompilerOptions() {
  const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) return {};
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    const message = ts.flattenDiagnosticMessageText(config.error.messageText, '\n');
    throw new Error(`Failed to read ${toRepoPath(configPath)}: ${message}`);
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
  if (parsed.errors.length > 0) {
    const messages = parsed.errors
      .map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n'))
      .join('\n');
    throw new Error(`Failed to parse ${toRepoPath(configPath)}:\n${messages}`);
  }
  return parsed.options;
}

function hasRuntimeNamedBindings(importClause) {
  if (!importClause) return true;
  if (importClause.name) return true;
  const bindings = importClause.namedBindings;
  if (!bindings) return false;
  if (ts.isNamespaceImport(bindings)) return true;
  return bindings.elements.some((element) => !element.isTypeOnly);
}

function hasRuntimeExportClause(exportClause) {
  if (!exportClause) return true;
  if (ts.isNamespaceExport(exportClause)) return true;
  return exportClause.elements.some((element) => !element.isTypeOnly);
}

function isRuntimeModuleEdge(node) {
  if (ts.isImportDeclaration(node)) {
    return !node.importClause?.isTypeOnly && hasRuntimeNamedBindings(node.importClause);
  }
  if (ts.isExportDeclaration(node)) {
    return !node.isTypeOnly && hasRuntimeExportClause(node.exportClause);
  }
  return false;
}

function resolveModule(fromFile, specifier, compilerOptions, compilerHost, sourceFiles) {
  const resolved = ts.resolveModuleName(
    specifier,
    fromFile,
    compilerOptions,
    compilerHost,
  ).resolvedModule;
  if (!resolved) return null;
  const resolvedPath = resolve(resolved.resolvedFileName);
  return sourceFiles.has(resolvedPath) ? resolvedPath : null;
}

function sourceKindFor(filePath) {
  return filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function buildRuntimeGraph(files, compilerOptions) {
  const sourceFiles = new Set(files.map((file) => resolve(file)));
  const compilerHost = ts.createCompilerHost(compilerOptions, false);
  const graph = new Map();

  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      sourceKindFor(file),
    );
    const deps = [];
    for (const statement of source.statements) {
      if (
        (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        isRuntimeModuleEdge(statement)
      ) {
        const dep = resolveModule(
          file,
          statement.moduleSpecifier.text,
          compilerOptions,
          compilerHost,
          sourceFiles,
        );
        if (dep) deps.push(dep);
      }
    }
    graph.set(resolve(file), deps);
  }

  return graph;
}

function stronglyConnectedComponents(graph) {
  const indexByNode = new Map();
  const lowlinkByNode = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  let nextIndex = 0;

  function visit(node) {
    indexByNode.set(node, nextIndex);
    lowlinkByNode.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const dep of graph.get(node) ?? []) {
      if (!indexByNode.has(dep)) {
        visit(dep);
        lowlinkByNode.set(node, Math.min(lowlinkByNode.get(node), lowlinkByNode.get(dep)));
      } else if (onStack.has(dep)) {
        lowlinkByNode.set(node, Math.min(lowlinkByNode.get(node), indexByNode.get(dep)));
      }
    }

    if (lowlinkByNode.get(node) !== indexByNode.get(node)) return;

    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== node);

    if (component.length > 1 || (graph.get(node) ?? []).includes(node)) {
      components.push(component);
    }
  }

  for (const node of graph.keys()) {
    if (!indexByNode.has(node)) visit(node);
  }

  return components;
}

function formatComponent(component) {
  return component
    .map(toRepoPath)
    .sort((a, b) => a.localeCompare(b))
    .map((path) => `    - ${path}`)
    .join('\n');
}

function main() {
  const files = walk(ROOT);
  const graph = buildRuntimeGraph(files, loadCompilerOptions());
  const cycles = stronglyConnectedComponents(graph).sort((a, b) =>
    formatComponent(a).localeCompare(formatComponent(b)),
  );

  if (cycles.length === 0) {
    console.log(
      `check-cycles PASSED -- no static runtime circular dependencies found across ${files.length} TypeScript source files.`,
    );
    return;
  }

  console.error(`FAIL: found ${cycles.length} static runtime circular dependency component(s).`);
  cycles.forEach((component, index) => {
    console.error(`\n${index + 1}) ${component.length} files`);
    console.error(formatComponent(component));
  });
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
