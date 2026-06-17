#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_ROOT = path.join(REPO_ROOT, 'types/api/src/api');
const TYPES_ROOT = path.join(REPO_ROOT, 'types');
const INVENTORY_FILE = path.join(REPO_ROOT, 'tools/operation-receipt-inventory.json');
const API_SPEC_FILE = path.join(REPO_ROOT, 'runtime/sdk/src/generated/api-spec.json');
const UPDATE = process.argv.includes('--update');

const BASE_OPERATION_RECEIPT_FIELDS = ['kind', 'status', 'effects', 'diagnostics'];
const DEFAULT_RATIONALE =
  'Generated initial disposition; refine as receipt waves migrate this API.';
const MIGRATED_RECEIPT_RATIONALE =
  'Returns an OperationReceiptBase-derived receipt with the public receipt base fields.';
const RECEIPT_REQUIRED_DISPOSITIONS = new Set(['receiptRequired', 'lifecycleReceiptRequired']);

const REQUIRED_GENERATED_RECEIPT_TYPES = [
  'OperationDiagnostic',
  'OperationDiagnosticTarget',
  'OperationEffect',
  'OperationEffectMapping',
  'OperationEffectType',
  'OperationReceiptBase',
  'OperationStatus',
];

const DISPOSITIONS = new Set([
  'noReceiptNeeded',
  'receiptExistingNeedsBase',
  'receiptRequired',
  'lifecycleReceiptRequired',
]);

const LIFECYCLE_METHODS = new Set([
  'autoFill',
  'clearAllCriteria',
  'clearColumnFilter',
  'compute',
  'createDataTable',
  'dataTable',
  'fillSeries',
  'queryPivot',
  'refresh',
  'refreshAll',
  'reapply',
  'setColumnFilter',
  'apply',
  'applyDynamicFilter',
]);

const LIFECYCLE_INTERFACES = new Set(['WorksheetPivots', 'WorksheetWhatIf']);

const MUTATION_NAME_PATTERN =
  /^(add|append|apply|autoFill|bring|cancel|clear|clone|commit|convert|copy|create|delete|duplicate|execute|fill|fillSeries|hide|import|insert|materialize|merge|move|paste|reapply|redo|refresh|remove|rename|replace|reset|resize|restore|send|set|show|sort|toggle|undo|unmerge|update|write)/;

function collectTsFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

function repoPath(filePath) {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
}

function compact(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}()[\]<>,:;|&=])\s*/g, '$1')
    .trim();
}

function collectTypeRefs(text) {
  return [...text.matchAll(/\b([A-Z][A-Za-z0-9]+)\b/g)].map(([, name]) => name);
}

function sourceLine(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function methodName(member, sourceFile) {
  return member.name?.getText(sourceFile) ?? '';
}

function returnTypeText(member, sourceFile) {
  return compact(member.type?.getText(sourceFile) ?? 'unknown');
}

function unwrapPromise(typeText) {
  const match = typeText.match(/^Promise<([\s\S]+)>$/);
  return match ? match[1] : typeText;
}

function returnCategory(typeText) {
  const inner = unwrapPromise(typeText);
  if (inner === 'void') return 'void';
  if (/\bReceipt\b|Receipt[>|&\s]/.test(inner) || /Receipt/.test(inner)) return 'receipt';
  if (/^(boolean|string|number)$/.test(inner)) return 'primitive';
  if (/^(boolean|string|number)\|/.test(inner) || /\|(boolean|string|number)\b/.test(inner)) {
    return 'primitive';
  }
  if (/\b(Result|Info|Config|State|Handle|Comment|Chart|Slicer|Table|Object)\b/.test(inner)) {
    return 'domainObject';
  }
  return 'other';
}

function isMutationLike(interfaceName, name) {
  if (LIFECYCLE_INTERFACES.has(interfaceName) && LIFECYCLE_METHODS.has(name)) return true;
  if (name === 'dataTable' || name === 'queryPivot' || name === 'fillSeries') return true;
  if (/^(get|list|has|find|describe|read|subscribe|on|off|watch)/.test(name)) return false;
  return MUTATION_NAME_PATTERN.test(name);
}

function returnsMigratedReceipt(typeText, migratedReceiptNames) {
  return collectTypeRefs(typeText).some((name) => migratedReceiptNames.has(name));
}

function defaultDisposition(entry, migratedReceiptNames) {
  if (returnsMigratedReceipt(entry.returnType, migratedReceiptNames)) {
    return 'noReceiptNeeded';
  }
  if (
    LIFECYCLE_INTERFACES.has(entry.interface) ||
    LIFECYCLE_METHODS.has(entry.method) ||
    entry.method === 'dataTable' ||
    entry.method === 'queryPivot' ||
    entry.method === 'fillSeries'
  ) {
    return 'lifecycleReceiptRequired';
  }
  if (entry.returnCategory === 'receipt') return 'receiptExistingNeedsBase';
  return 'receiptRequired';
}

function inventoryEntries(migratedReceiptNames) {
  const files = collectTsFiles(API_ROOT).filter((file) => !file.endsWith('/index.ts'));
  const entries = [];
  const keyCounts = new Map();

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    ts.forEachChild(sourceFile, function visit(node) {
      if (ts.isInterfaceDeclaration(node)) {
        const interfaceName = node.name.text;
        for (const member of node.members) {
          if (!ts.isMethodSignature(member)) continue;
          const name = methodName(member, sourceFile);
          if (!name || !isMutationLike(interfaceName, name)) continue;

          const baseKey = `${repoPath(file)}#${interfaceName}.${name}`;
          const count = (keyCounts.get(baseKey) ?? 0) + 1;
          keyCounts.set(baseKey, count);
          const key = count === 1 ? baseKey : `${baseKey}:${count}`;
          const typeText = returnTypeText(member, sourceFile);
          const entry = {
            key,
            file: repoPath(file),
            line: sourceLine(sourceFile, member),
            interface: interfaceName,
            method: name,
            signature: compact(member.getText(sourceFile)),
            returnType: typeText,
            returnCategory: returnCategory(typeText),
          };
          entries.push({
            ...entry,
            disposition: defaultDisposition(entry, migratedReceiptNames),
            rationale: returnsMigratedReceipt(typeText, migratedReceiptNames)
              ? MIGRATED_RECEIPT_RATIONALE
              : DEFAULT_RATIONALE,
          });
        }
      }
      ts.forEachChild(node, visit);
    });
  }

  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

function readInventory() {
  if (!fs.existsSync(INVENTORY_FILE)) return [];
  return JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));
}

function writeInventory(entries) {
  fs.writeFileSync(INVENTORY_FILE, `${JSON.stringify(entries, null, 2)}\n`);
}

function hasReceiptRequirementJustification(entry) {
  return (
    typeof entry.receiptRequirementJustification === 'string' &&
    entry.receiptRequirementJustification.trim().length > 0
  );
}

function mergeInventory(current, existing) {
  const byKey = new Map(existing.map((entry) => [entry.key, entry]));
  return current.map((entry) => {
    const previous = byKey.get(entry.key);
    if (!previous) return entry;
    if (
      entry.disposition === 'noReceiptNeeded' &&
      (previous.disposition === 'receiptExistingNeedsBase' ||
        (RECEIPT_REQUIRED_DISPOSITIONS.has(previous.disposition) &&
          !hasReceiptRequirementJustification(previous)))
    ) {
      return entry;
    }
    return {
      ...previous,
      ...entry,
      disposition: previous.disposition,
      rationale: previous.rationale,
    };
  });
}

function typeReferenceName(node, sourceFile) {
  if (!ts.isTypeReferenceNode(node)) return null;
  return node.typeName.getText(sourceFile).split('.').pop() ?? null;
}

function isIgnorableUnionPart(node) {
  if (
    node.kind === ts.SyntaxKind.NullKeyword ||
    node.kind === ts.SyntaxKind.UndefinedKeyword ||
    node.kind === ts.SyntaxKind.VoidKeyword ||
    node.kind === ts.SyntaxKind.NeverKeyword
  ) {
    return true;
  }
  return ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword;
}

function typeNodeReturnsMigratedReceipt(
  node,
  sourceFile,
  interfaceReceiptNames,
  aliasReceiptNames,
) {
  const referenceName = typeReferenceName(node, sourceFile);
  if (referenceName) {
    return (
      referenceName === 'OperationReceiptBase' ||
      interfaceReceiptNames.has(referenceName) ||
      aliasReceiptNames.has(referenceName)
    );
  }
  if (ts.isParenthesizedTypeNode(node)) {
    return typeNodeReturnsMigratedReceipt(
      node.type,
      sourceFile,
      interfaceReceiptNames,
      aliasReceiptNames,
    );
  }
  if (ts.isIntersectionTypeNode(node)) {
    return node.types.some((part) =>
      typeNodeReturnsMigratedReceipt(part, sourceFile, interfaceReceiptNames, aliasReceiptNames),
    );
  }
  if (ts.isUnionTypeNode(node)) {
    const meaningfulParts = node.types.filter((part) => !isIgnorableUnionPart(part));
    return (
      meaningfulParts.length > 0 &&
      meaningfulParts.every((part) =>
        typeNodeReturnsMigratedReceipt(part, sourceFile, interfaceReceiptNames, aliasReceiptNames),
      )
    );
  }
  return false;
}

function migratedReceiptTypeInfo() {
  const heritageByName = new Map();
  const aliasTypeByName = new Map();
  for (const filePath of collectTsFiles(TYPES_ROOT)) {
    const text = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
    ts.forEachChild(sourceFile, (node) => {
      if (ts.isInterfaceDeclaration(node)) {
        const heritageNames = [];
        for (const clause of node.heritageClauses ?? []) {
          if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
          for (const type of clause.types) {
            heritageNames.push(type.expression.getText(sourceFile).split('.').pop() ?? '');
          }
        }
        if (heritageNames.length > 0) {
          heritageByName.set(node.name.text, heritageNames);
        }
        return;
      }
      if (ts.isTypeAliasDeclaration(node)) {
        aliasTypeByName.set(node.name.text, { node: node.type, sourceFile });
      }
    });
  }

  const interfaceReceiptNames = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, heritageNames] of heritageByName) {
      if (
        !interfaceReceiptNames.has(name) &&
        heritageNames.some(
          (heritageName) =>
            heritageName === 'OperationReceiptBase' || interfaceReceiptNames.has(heritageName),
        )
      ) {
        interfaceReceiptNames.add(name);
        changed = true;
      }
    }
  }

  const aliasReceiptNames = new Set();
  changed = true;
  while (changed) {
    changed = false;
    for (const [name, { node, sourceFile }] of aliasTypeByName) {
      if (
        !aliasReceiptNames.has(name) &&
        typeNodeReturnsMigratedReceipt(node, sourceFile, interfaceReceiptNames, aliasReceiptNames)
      ) {
        aliasReceiptNames.add(name);
        changed = true;
      }
    }
  }
  return {
    generatedReceiptNames: [...interfaceReceiptNames].sort(),
    returnReceiptNames: [...new Set([...interfaceReceiptNames, ...aliasReceiptNames])].sort(),
  };
}

function generatedDefinitionFields(name, definition, errors) {
  const sourceFile = ts.createSourceFile(
    `${name}.d.ts`,
    `type __GeneratedReceiptDefinition = ${definition};`,
    ts.ScriptTarget.Latest,
    true,
  );
  let typeNode = null;
  ts.forEachChild(sourceFile, (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === '__GeneratedReceiptDefinition') {
      typeNode = node.type;
    }
  });
  if (!typeNode || !ts.isTypeLiteralNode(typeNode)) {
    errors.push(`Generated ${name} definition is not an object type literal`);
    return new Set();
  }

  const fields = new Set();
  for (const member of typeNode.members) {
    if (ts.isPropertySignature(member) && member.name) {
      fields.add(member.name.getText(sourceFile).replace(/^['"]|['"]$/g, ''));
    }
  }
  return fields;
}

function verifyBaseFieldsInGeneratedDefinition(errors, name, definition) {
  const fields = generatedDefinitionFields(name, definition, errors);
  for (const field of BASE_OPERATION_RECEIPT_FIELDS) {
    if (!fields.has(field)) {
      errors.push(`Generated ${name} definition omits base field ${field}`);
    }
  }
}

function verifyGeneratedReceiptDefinitions(errors, migrated) {
  if (!fs.existsSync(API_SPEC_FILE)) {
    errors.push(`Missing generated API spec: ${repoPath(API_SPEC_FILE)}`);
    return;
  }
  const spec = JSON.parse(fs.readFileSync(API_SPEC_FILE, 'utf8'));
  for (const name of REQUIRED_GENERATED_RECEIPT_TYPES) {
    if (!spec.types?.[name]) {
      errors.push(`Generated API spec is missing public operation receipt grammar type ${name}`);
    }
  }
  const baseDefinition = spec.types?.OperationReceiptBase?.definition;
  if (typeof baseDefinition === 'string') {
    verifyBaseFieldsInGeneratedDefinition(errors, 'OperationReceiptBase', baseDefinition);
  }

  for (const name of migrated) {
    const definition = spec.types?.[name]?.definition;
    if (typeof definition !== 'string') {
      errors.push(`Generated API spec is missing migrated receipt type ${name}`);
      continue;
    }
    verifyBaseFieldsInGeneratedDefinition(errors, name, definition);
  }
}

function verifyMigratedReceiptDispositions(
  errors,
  currentEntry,
  recordedEntry,
  migratedReceiptNames,
) {
  if (!returnsMigratedReceipt(currentEntry.returnType, migratedReceiptNames)) return;
  if (recordedEntry.disposition === 'receiptExistingNeedsBase') {
    errors.push(
      `Migrated receipt method ${currentEntry.key} returns ${currentEntry.returnType} but is still marked receiptExistingNeedsBase`,
    );
  }
  if (
    RECEIPT_REQUIRED_DISPOSITIONS.has(recordedEntry.disposition) &&
    !hasReceiptRequirementJustification(recordedEntry)
  ) {
    errors.push(
      [
        `Migrated receipt method ${currentEntry.key} returns ${currentEntry.returnType}`,
        `but is still marked ${recordedEntry.disposition};`,
        'add receiptRequirementJustification only if this still intentionally needs a separate receipt migration',
      ].join(' '),
    );
  }
}

const migratedReceiptInfo = migratedReceiptTypeInfo();
const migratedReceiptNames = new Set([
  'OperationReceiptBase',
  ...migratedReceiptInfo.returnReceiptNames,
]);
const current = inventoryEntries(migratedReceiptNames);
const existing = readInventory();

if (UPDATE) {
  writeInventory(mergeInventory(current, existing));
  console.log(`Updated ${repoPath(INVENTORY_FILE)} with ${current.length} mutation-like methods.`);
  process.exit(0);
}

const errors = [];
const existingByKey = new Map(existing.map((entry) => [entry.key, entry]));
const currentByKey = new Map(current.map((entry) => [entry.key, entry]));

for (const entry of current) {
  const recorded = existingByKey.get(entry.key);
  if (!recorded) {
    errors.push(`Missing receipt inventory disposition for ${entry.key}`);
    continue;
  }
  if (!DISPOSITIONS.has(recorded.disposition)) {
    errors.push(`Invalid disposition for ${entry.key}: ${recorded.disposition}`);
  }
  verifyMigratedReceiptDispositions(errors, entry, recorded, migratedReceiptNames);
  if (
    recorded.returnCategory !== entry.returnCategory ||
    recorded.returnType !== entry.returnType
  ) {
    errors.push(
      `Stale receipt inventory return shape for ${entry.key}: expected ${entry.returnType} (${entry.returnCategory}), found ${recorded.returnType} (${recorded.returnCategory})`,
    );
  }
}

for (const entry of existing) {
  if (!currentByKey.has(entry.key)) {
    errors.push(`Receipt inventory contains stale method ${entry.key}`);
  }
}

verifyGeneratedReceiptDefinitions(errors, migratedReceiptInfo.generatedReceiptNames);

if (errors.length > 0) {
  console.error(`Operation receipt guard failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  console.error(
    '\nRun `node tools/check-operation-receipts.mjs --update` after intentional API changes.',
  );
  process.exit(1);
}

console.log(`Operation receipt guard passed for ${current.length} mutation-like methods.`);
