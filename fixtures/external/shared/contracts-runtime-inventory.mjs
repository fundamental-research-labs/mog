import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const INVENTORY_CANDIDATES = [
  'contracts/contracts-runtime-inventory.json',
  'contracts/contracts-runtime-inventory.jsonc',
  'contracts/runtime-inventory.json',
  'contracts/runtime-inventory.jsonc',
  'contracts/runtime-export-inventory.json',
  'contracts/runtime-export-inventory.jsonc',
  'contracts/src/generated/contracts-runtime-inventory.json',
  'contracts/src/generated/contracts-runtime-inventory.jsonc',
  'contracts/src/generated/runtime-inventory.json',
  'contracts/src/generated/runtime-inventory.jsonc',
  'tools/contracts-runtime-inventory.json',
  'tools/contracts-runtime-inventory.jsonc',
  'tools/contracts-runtime-export-inventory.json',
  'tools/contracts-runtime-export-inventory.jsonc',
];

const BASELINE_RUNTIME_VALUES = [
  {
    module: '@mog-sdk/contracts/cell-identity',
    symbol: 'toCellId',
    reason: 'representative retained runtime value',
  },
];

export function prepareContractsRuntimeInventoryFixture(monorepoRoot, tmpDir) {
  const inventory = loadRuntimeInventory(monorepoRoot);
  const values = mergeRuntimeValues(BASELINE_RUNTIME_VALUES, inventory.values);
  const generatedBy = inventory.path
    ? `runtime inventory ${relative(monorepoRoot, inventory.path)}`
    : 'baseline fixture coverage';

  writeFileSync(
    resolve(tmpDir, 'inventory-runtime-smoke.ts'),
    renderTypeScriptSmoke(values, generatedBy),
  );
  writeFileSync(
    resolve(tmpDir, 'inventory-runtime-smoke.mjs'),
    renderRuntimeSmoke(values, generatedBy),
  );

  return {
    generatedBy,
    runtimeValueCount: values.length,
  };
}

function loadRuntimeInventory(monorepoRoot) {
  for (const candidate of INVENTORY_CANDIDATES) {
    const path = resolve(monorepoRoot, candidate);
    if (!existsSync(path)) continue;
    const inventory = parseJsonc(readFileSync(path, 'utf-8'), path);
    return {
      path,
      values: extractRetainedContractsRuntimeValues(inventory),
    };
  }

  return {
    path: null,
    values: [],
  };
}

function parseJsonc(source, path) {
  try {
    return JSON.parse(
      source
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/,\s*([\]}])/g, '$1'),
    );
  } catch (error) {
    throw new Error(`Could not parse contracts runtime inventory ${path}: ${error.message}`);
  }
}

function extractRetainedContractsRuntimeValues(inventory) {
  const values = [];
  visitInventory(inventory, (entry) => {
    for (const value of groupedRuntimeValues(entry)) {
      values.push(value);
    }

    const module = publicContractsModule(entry);
    const symbol = exportedSymbol(entry);
    if (!module || !symbol || !isRetainedRuntimeEntry(entry)) return;
    values.push({
      module,
      symbol,
      reason: entry.reason ?? entry.disposition ?? entry.classification ?? 'runtime inventory',
    });
  });
  return values;
}

function groupedRuntimeValues(entry) {
  if (
    !isRetainedRuntimeEntry(entry) ||
    !Array.isArray(entry.publicModules) ||
    !Array.isArray(entry.runtimeExports)
  ) {
    return [];
  }

  const modules = entry.publicModules
    .map((module) => publicContractsModule({ module }))
    .filter(Boolean);
  const symbols = entry.runtimeExports.filter(
    (symbol) => typeof symbol === 'string' && symbol.length > 0,
  );
  const values = [];

  for (const module of modules) {
    for (const symbol of symbols) {
      values.push({
        module,
        symbol,
        reason: entry.reason ?? entry.disposition ?? entry.classification ?? 'runtime inventory',
      });
    }
  }

  return values;
}

function visitInventory(value, onEntry) {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const item of value) {
      visitInventory(item, onEntry);
    }
    return;
  }

  onEntry(value);
  for (const nested of Object.values(value)) {
    visitInventory(nested, onEntry);
  }
}

function isRetainedRuntimeEntry(entry) {
  const text = [
    entry.classification,
    entry.kind,
    entry.disposition,
    entry.ownership,
    entry.runtime,
    entry.runtimeKind,
    entry.hasRuntime,
    entry.emitsRuntime,
    entry.retained,
  ]
    .map((value) => String(value ?? '').toLowerCase())
    .join(' ');

  const isRuntime =
    entry.hasRuntime === true ||
    entry.emitsRuntime === true ||
    entry.runtime === true ||
    text.includes('runtime-valued') ||
    text.includes('runtime value') ||
    text.includes('public contract runtime') ||
    text.includes('value');

  const isRetained =
    entry.retained === true ||
    text.includes('contracts-owned') ||
    text.includes('generated-projection') ||
    text.includes('moved-public-runtime') ||
    text.includes('public contract runtime') ||
    text.includes('retain') ||
    text.includes('retained');

  const isRemoved =
    text.includes('removed-from-public-surface') ||
    text.includes('private implementation helper') ||
    text.includes('type-only');

  return isRuntime && isRetained && !isRemoved;
}

function publicContractsModule(entry) {
  const raw =
    entry.targetPublicModuleIdentity ??
    entry.publicModuleIdentity ??
    entry.publicModule ??
    entry.targetModule ??
    entry.module ??
    entry.publicSubpath ??
    entry.targetPublicSubpath ??
    entry.subpath;

  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw === '@mog-sdk/contracts') return raw;
  if (raw.startsWith('@mog-sdk/contracts/')) return raw;
  if (raw === '.' || raw === './') return '@mog-sdk/contracts';
  if (raw.startsWith('./')) return `@mog-sdk/contracts/${raw.slice(2)}`;
  if (!raw.startsWith('@') && !raw.startsWith('.')) {
    return `@mog-sdk/contracts/${raw.replace(/^\//, '')}`;
  }
  return null;
}

function exportedSymbol(entry) {
  const raw =
    entry.exportedSymbolName ??
    entry.exportedSymbol ??
    entry.symbolName ??
    entry.symbol ??
    entry.exportName ??
    entry.name;

  if (typeof raw !== 'string' || raw.length === 0) return null;
  return raw;
}

function mergeRuntimeValues(...groups) {
  const byKey = new Map();
  for (const group of groups) {
    for (const value of group) {
      byKey.set(`${value.module}\0${value.symbol}`, value);
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const moduleOrder = a.module.localeCompare(b.module);
    return moduleOrder === 0 ? a.symbol.localeCompare(b.symbol) : moduleOrder;
  });
}

function renderTypeScriptSmoke(values, generatedBy) {
  const imports = values
    .filter((value) => isIdentifier(value.symbol))
    .map((value, index) => {
      return `import { ${value.symbol} as runtimeValue${index} } from '${value.module}';`;
    })
    .join('\n');
  const voids = values
    .filter((value) => isIdentifier(value.symbol))
    .map((_value, index) => `void runtimeValue${index};`)
    .join('\n');

  return `// Generated by fixtures/external from ${generatedBy}.
${imports}

${voids}
`;
}

function renderRuntimeSmoke(values, generatedBy) {
  return `// Generated by fixtures/external from ${generatedBy}.
const runtimeValues = ${JSON.stringify(values, null, 2)};

for (const runtimeValue of runtimeValues) {
  const moduleExports = await import(runtimeValue.module);
  if (!Object.prototype.hasOwnProperty.call(moduleExports, runtimeValue.symbol)) {
    throw new Error(\`\${runtimeValue.module} does not export \${runtimeValue.symbol}\`);
  }
  if (moduleExports[runtimeValue.symbol] === undefined) {
    throw new Error(\`\${runtimeValue.module} export \${runtimeValue.symbol} is undefined\`);
  }
}
`;
}

function isIdentifier(value) {
  return /^[$A-Z_a-z][$\w]*$/.test(value);
}
