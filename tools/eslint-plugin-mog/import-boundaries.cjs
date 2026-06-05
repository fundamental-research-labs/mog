/**
 * ESLint rule: mog/import-boundaries
 *
 * Gate 2: Source-level import direction enforcement.
 * Enforces the workspace layer DAG — prevents imports that violate
 * the dependency direction (e.g. hardware importing kernel, kernel
 * importing views, etc.).
 *
 * Layers (from bottom to top):
 *   0. types     — types/, contracts/
 *   1. hardware  — infra/, canvas/, charts/, table-engine/, spreadsheet-utils/,
 *                  file-io/, typeset/, compute/
 *   2. kernel    — kernel/
 *   3. views     — views/
 *   4. shell     — shell/, ui/
 *   5. apps      — apps/
 *   2k. kernel-host-internal — kernel/host-internal/ (private trusted adapter entry)
 *   6. runtime   — runtime/sdk/, runtime/embed/, runtime/server/
 *   6t. test-host — runtime/test-host/ (deterministic test host, workspace-internal)
 *   -. dev       — dev/, tools/ (unrestricted except app re-export ban)
 */

'use strict';

const path = require('path');

// ── Layer classification by directory prefix ────────────────────────────
// Longer prefixes must come first so they match before shorter ones.

const LAYER_MAP = [
  // Layer 0: Types and contracts
  { prefix: 'types/', layer: 'types' },
  { prefix: 'contracts/', layer: 'types' },

  // Layer 1: Hardware / infra
  { prefix: 'infra/', layer: 'hardware' },
  { prefix: 'canvas/', layer: 'hardware' },
  { prefix: 'charts/', layer: 'hardware' },
  { prefix: 'table-engine/', layer: 'hardware' },
  { prefix: 'spreadsheet-utils/', layer: 'hardware' },
  { prefix: 'file-io/', layer: 'hardware' },
  { prefix: 'typeset/', layer: 'hardware' },
  { prefix: 'compute/', layer: 'hardware' },

  // Layer 2: Kernel (specific prefixes before generic)
  { prefix: 'kernel/host-internal/', layer: 'kernel-host-internal' },
  { prefix: 'kernel/', layer: 'kernel' },

  // Layer 3: Views
  { prefix: 'views/', layer: 'views' },

  // Layer 4: Shell / app-platform
  { prefix: 'shell/', layer: 'shell' },
  { prefix: 'ui/', layer: 'shell' },

  // Layer 5: Apps
  { prefix: 'apps/', layer: 'apps' },

  // Layer 6: Runtime facades — more specific prefixes first
  { prefix: 'runtime/test-host/', layer: 'test-host' },
  { prefix: 'runtime/src-tauri/', layer: 'runtime' },
  { prefix: 'runtime/sdk/', layer: 'runtime' },
  { prefix: 'runtime/embed/', layer: 'runtime' },
  { prefix: 'runtime/server/', layer: 'runtime' },

  // Dev/eval: unrestricted
  { prefix: 'dev/app/', layer: 'apps' },
  { prefix: 'dev/', layer: 'dev' },
  { prefix: 'tools/', layer: 'dev' },
];

// ── Package name to layer mapping ───────────────────────────────────────
// Maps @mog/* and @mog-sdk/* package names to their layer.
// Used to classify import targets.

const PACKAGE_LAYER_MAP = {
  // types (layer 0)
  '@mog/types-api': 'types',
  '@mog/types-bridges': 'types',
  '@mog/types-commands': 'types',
  '@mog/types-connections': 'types',
  '@mog/types-core': 'types',
  '@mog/types-culture': 'types',
  '@mog/types-data': 'types',
  '@mog-sdk/types-document': 'types',
  '@mog-sdk/types-host': 'types',
  '@mog/types-editor': 'types',
  '@mog/types-events': 'types',
  '@mog/types-formatting': 'types',
  '@mog/types-machines': 'types',
  '@mog/types-objects': 'types',
  '@mog/types-rendering': 'types',
  '@mog/types-viewport': 'types',

  // hardware (layer 1)
  '@mog/canvas-engine': 'hardware',
  '@mog/grid-canvas': 'hardware',
  '@mog/grid-renderer': 'hardware',
  '@mog/drawing-canvas': 'hardware',
  '@mog/canvas-overlay': 'hardware',
  '@mog/spatial': 'hardware',
  '@mog/drawing-engine': 'hardware',
  '@mog/geometry': 'hardware',
  '@mog/shape-engine': 'hardware',
  '@mog/ink-engine': 'hardware',
  '@mog/smartart': 'hardware',
  '@mog/wordart-engine': 'hardware',
  '@mog/charts': 'hardware',
  '@mog/table-engine': 'hardware',
  '@mog/spreadsheet-utils': 'hardware',
  '@mog/transport': 'hardware',
  '@mog/platform': 'hardware',
  '@mog/platform-memory': 'hardware',
  '@mog/culture': 'hardware',
  '@mog/env': 'hardware',
  '@mog/bridge-ts': 'hardware',
  '@rust-bridge/client': 'hardware',
  '@mog/math-engine': 'hardware',
  '@mog/xlsx-parser': 'hardware',
  '@mog/print-export': 'hardware',
  '@mog/pdf-graphics': 'hardware',
  '@mog/pdf-layout': 'hardware',
  '@mog/icons': 'hardware',
  '@mog/xlsx-parser-wasm': 'hardware',
  '@mog-sdk/wasm': 'hardware',
  '@mog-sdk/darwin-arm64': 'hardware',
  '@mog-sdk/darwin-x64': 'hardware',
  '@mog-sdk/linux-arm64-gnu': 'hardware',
  '@mog-sdk/linux-arm64-musl': 'hardware',
  '@mog-sdk/linux-x64-gnu': 'hardware',
  '@mog-sdk/linux-x64-musl': 'hardware',
  '@mog-sdk/win32-x64-msvc': 'hardware',

  // kernel (layer 2)
  '@mog/kernel-host-internal': 'kernel-host-internal',
  '@mog-sdk/kernel': 'kernel',

  // views (layer 3)
  '@mog-sdk/sheet-view': 'views',

  // shell (layer 4)
  '@mog/shell': 'shell',
  '@mog/ui': 'shell',

  // apps (layer 5)
  '@mog/app-spreadsheet': 'apps',

  // runtime (layer 6)
  '@mog/test-host': 'test-host',
  '@mog-sdk/sdk': 'runtime',
  '@mog-sdk/embed': 'runtime',
  '@mog/collaboration-server': 'runtime',
  '@mog/os-headless-server': 'dev',
};

// ── Forbidden import matrix ─────────────────────────────────────────────

const FORBIDDEN_IMPORTS = {
  types: {
    deny: [
      'hardware',
      'kernel',
      'kernel-host-internal',
      'views',
      'shell',
      'apps',
      'runtime',
      'test-host',
    ],
    message: 'Type packages must not import from implementation packages.',
  },
  hardware: {
    deny: ['kernel', 'kernel-host-internal', 'views', 'shell', 'apps', 'test-host'],
    message: 'Hardware/infra packages must not import from kernel, views, shell, or apps.',
  },
  kernel: {
    deny: ['views', 'shell', 'apps', 'kernel-host-internal'],
    message: 'Kernel must not import from views, shell, apps, or kernel-host-internal (sibling).',
  },
  'kernel-host-internal': {
    deny: ['kernel', 'views', 'shell', 'apps'],
    message: 'kernel-host-internal must not import from kernel (sibling), views, shell, or apps.',
  },
  views: {
    deny: ['shell', 'apps', 'kernel-host-internal'],
    message: 'View packages must not import from shell, apps, or kernel-host-internal.',
  },
  shell: {
    deny: ['apps', 'kernel-host-internal'],
    message: 'Shell/UI must not import from apps or kernel-host-internal.',
  },
  runtime: {
    deny: ['apps', 'shell'],
    message: 'Runtime facades must not import from apps or shell.',
  },
  'test-host': {
    deny: ['kernel', 'views', 'shell', 'apps'],
    message:
      'Test host must not import kernel source, views, shell, or apps. Use @mog/kernel-host-internal.',
  },
  apps: {
    deny: ['kernel-host-internal'],
    message: 'Apps must not import kernel-host-internal.',
  },
  // dev has no layer restrictions
  // Note: @mog/test-host access is controlled by a separate test-file check
  // (not through FORBIDDEN_IMPORTS) to allow test files in any layer to use it.
};

// ── Host subpath restrictions ───────────────────────────────────────────
// @mog-sdk/types-host has subpath-specific import rules per 02a plan.
// Each layer may only import the narrow slices it needs.

const HOST_SUBPATH_RULES = {
  hardware: {
    allowed: [],
    message: 'Hardware packages must not import any host contracts.',
  },
  kernel: {
    allowed: [
      '/kernel',
      '/identity',
      '/storage',
      '/runtime',
      '/operations',
      '/capabilities',
      '/fingerprints',
      '/trust',
      '/diagnostics',
      '/bindings',
    ],
    message:
      'Kernel may only import narrow host contract slices, not /index, /trusted, /view, or /shell.',
  },
  'kernel-host-internal': {
    allowed: [
      '/kernel',
      '/identity',
      '/storage',
      '/runtime',
      '/operations',
      '/capabilities',
      '/fingerprints',
      '/trust',
      '/diagnostics',
      '/bindings',
    ],
    message: 'kernel-host-internal may import narrow host contract slices, same as kernel.',
  },
  views: {
    allowed: ['/view', '/diagnostics'],
    message: 'Views may only import @mog-sdk/types-host/view and /diagnostics.',
  },
  shell: {
    allowed: ['/shell', '/identity', '/trust', '/diagnostics'],
    message:
      'Shell may only import @mog-sdk/types-host/shell, /identity, /trust, and /diagnostics.',
  },
  apps: {
    allowed: ['/shell', '/identity', '/trust', '/diagnostics'],
    message: 'Apps may only import @mog-sdk/types-host/shell, /identity, /trust, and /diagnostics.',
  },
  runtime: {
    allowed: [
      '/kernel',
      '/identity',
      '/storage',
      '/runtime',
      '/operations',
      '/capabilities',
      '/fingerprints',
      '/trust',
      '/diagnostics',
      '/trusted',
      '/untrusted',
      '/view',
      '/shell',
      '/bindings',
    ],
    message: 'Runtime facades construct trusted contexts and may import most host subpaths.',
  },
  'test-host': {
    allowed: [
      '/kernel',
      '/identity',
      '/storage',
      '/runtime',
      '/operations',
      '/capabilities',
      '/fingerprints',
      '/trust',
      '/diagnostics',
      '/trusted',
      '/view',
      '/shell',
      '/bindings',
    ],
    message: 'Test host may import all host subpaths including /trusted for branded construction.',
  },
};

function isHostAdapterFile(filename) {
  const normalized = filename.replace(/\\/g, '/');
  return normalized.includes('/host-adapters/');
}

function isTrustedSubpathAllowedFile(filename) {
  const normalized = filename.replace(/\\/g, '/');
  if (normalized.includes('/types/host/src/')) return true;
  if (normalized.includes('/__tests__/')) return true;
  if (normalized.includes('.test.')) return true;
  if (normalized.includes('/runtime/')) return true;
  if (isHostAdapterFile(normalized)) return true;
  return false;
}

// ── App re-export ban patterns ──────────────────────────────────────────
// Catches `export * from '@mog-sdk/kernel'` etc. inside apps/*

const LOWER_LAYER_REEXPORT_PATTERNS = [
  /^@mog-sdk\/kernel/,
  /^@mog\/kernel/,
  /^@mog\/shell/,
  /^@mog-sdk\/sheet-view/,
  /^@mog\/ui/,
];

const KERNEL_CAPABILITY_RUNTIME_IMPORTS = new Set([
  'CapabilityAuditLogger',
  'MemoryGrantsStore',
  'SQLiteGrantsStore',
  'CloudGrantsStore',
  'createCapabilityAuditLogger',
  'createCapabilityRegistry',
  'createMemoryGrantsStore',
  'createSQLiteGrantsStore',
  'createCloudGrantsStore',
]);

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve the layer for a source file based on its path relative to the
 * monorepo root.
 */
function resolveLayerFromFile(filename, cwd) {
  const absolute = path.isAbsolute(filename) ? filename : path.resolve(cwd, filename);
  const relative = path.relative(cwd, absolute).replace(/\\/g, '/');

  if (
    relative.startsWith('node_modules/') ||
    relative.startsWith('.claude/worktrees/') ||
    relative.startsWith('../')
  ) {
    return null;
  }

  // Match only the package/workspace prefix from the repository root. Do not
  // classify nested app folders such as apps/spreadsheet/src/infra as infra/.
  for (const entry of LAYER_MAP) {
    if (relative.startsWith(entry.prefix)) {
      return entry.layer;
    }
  }

  return null;
}

/**
 * Resolve the layer for an import target based on its package name.
 * Only handles workspace packages (@mog/*, @mog-sdk/*, @rust-bridge/*).
 */
function resolveLayerFromPackageName(importPath) {
  // Extract the bare package name (strip subpath).
  // e.g. "@mog-sdk/kernel/api" -> "@mog-sdk/kernel"
  //      "@mog-sdk/contracts/core" -> "@mog-sdk/contracts"
  //      "@mog-sdk/wasm" -> "@mog-sdk/wasm"
  let pkgName;
  if (importPath.startsWith('@')) {
    // Scoped package: @scope/name/subpath -> @scope/name
    const parts = importPath.split('/');
    pkgName = parts.slice(0, 2).join('/');
  } else {
    // Unscoped: name/subpath -> name
    pkgName = importPath.split('/')[0];
  }

  return PACKAGE_LAYER_MAP[pkgName] || null;
}

// ── Rule definition ─────────────────────────────────────────────────────

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce dependency direction between workspace package layers.',
      category: 'Architecture',
    },
    schema: [],
    messages: {
      forbiddenImport:
        'Import from "{{source}}" violates boundary: {{reason}} ' +
        '(source layer: {{sourceLayer}}, target layer: {{targetLayer}})',
      forbiddenReExport:
        'Re-exporting "{{source}}" from an apps/* package violates dependency direction. ' +
        'Product apps must not be gateways to lower layers.',
      forbiddenTauriImport:
        'Import of "{{source}}" from generic shell code violates host boundary. ' +
        'Only designated Tauri integration files and host-adapters may import @tauri-apps/*.',
      forbiddenEmbedAppImport:
        'Import of "{{source}}" from embed core violates layering. ' +
        'runtime/embed core must not import spreadsheet app or shell chrome. Use host-adapters/ for product composition.',
      forbiddenTauriGlobal:
        'Probing __TAURI__ or __TAURI_INTERNALS__ is only allowed in designated Tauri integration files ' +
        'and host-adapters. Generic shell code must not test for Tauri globals.',
      forbiddenCrossAdapterImport:
        'Import of "{{source}}" crosses adapter boundaries. ' +
        "Adapters must not deep-import another product's host-adapters/ directory.",
      forbiddenKernelInternalImport:
        'Import of "{{source}}" violates kernel boundary. Apps must use public kernel/shell APIs, never @mog-sdk/kernel/internal.',
      forbiddenKernelCapabilityRuntimeImport:
        'Import of concrete capability runtime "{{name}}" from "{{source}}" violates capability ownership. Shell capability runtime must come from @mog/shell/capabilities.',
      forbiddenDevAppKernelInternalAlias:
        'dev/app must not alias @mog-sdk/kernel/internal. App code should not be able to resolve kernel internals.',
    },
  },

  create(context) {
    const filename = context.getFilename().replace(/\\/g, '/');
    const cwd = typeof context.getCwd === 'function' ? context.getCwd() : process.cwd();

    // Determine which layer this file belongs to
    const sourceLayer = resolveLayerFromFile(filename, cwd);
    if (!sourceLayer) return {}; // file not in a classified directory

    const forbidden = FORBIDDEN_IMPORTS[sourceLayer];

    function checkImportPath(node, source, importPath) {
      if (typeof importPath !== 'string') return;

      if (
        sourceLayer === 'apps' &&
        (importPath === '@mog-sdk/kernel/internal' ||
          importPath.startsWith('@mog-sdk/kernel/internal/') ||
          importPath === '@mog-sdk/kernel/services/capabilities' ||
          importPath.startsWith('@mog-sdk/kernel/services/capabilities/'))
      ) {
        context.report({
          node: source,
          messageId: 'forbiddenKernelInternalImport',
          data: { source: importPath },
        });
        return;
      }

      if (node.type === 'ImportDeclaration' && importPath === '@mog-sdk/kernel') {
        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            KERNEL_CAPABILITY_RUNTIME_IMPORTS.has(specifier.imported.name)
          ) {
            context.report({
              node: specifier,
              messageId: 'forbiddenKernelCapabilityRuntimeImport',
              data: { source: importPath, name: specifier.imported.name },
            });
          }
        }
      }

      // ── Tauri import restriction for generic shell code (02c-A) ────────
      // Only designated Tauri integration files and host-adapters may import
      // @tauri-apps/* packages. This keeps Tauri coupling confined so the
      // shell can run in non-Tauri environments (embed, web, test).
      // This check runs before the workspace-package guard since @tauri-apps
      // is a third-party scope.
      if (importPath.startsWith('@tauri-apps/') && sourceLayer === 'shell') {
        const normalizedFile = filename.replace(/\\/g, '/');
        const ALLOWED_TAURI_FILES = [
          'shell/src/bootstrap/event-dispatcher.ts',
          'shell/src/hooks/use-tauri-drop-zone.ts',
          'shell/src/hooks/use-native-menu.ts',
          'shell/src/services/project/tauri-ipc.ts',
        ];
        const isAllowedTauriFile =
          ALLOWED_TAURI_FILES.some((f) => normalizedFile.endsWith(f)) ||
          normalizedFile.includes('/shell/src/host-adapters/');
        if (!isAllowedTauriFile) {
          context.report({
            node: source,
            messageId: 'forbiddenTauriImport',
            data: { source: importPath },
          });
          return;
        }
      }

      // Only check workspace package imports (all use scoped names)
      if (
        !importPath.startsWith('@mog/') &&
        !importPath.startsWith('@mog-sdk/') &&
        !importPath.startsWith('@rust-bridge/')
      ) {
        return;
      }

      // Resolve the import to a layer
      const targetLayer = resolveLayerFromPackageName(importPath);
      if (!targetLayer) return;

      // Check layer violation
      if (forbidden && forbidden.deny.includes(targetLayer)) {
        // Kernel test files may import kernel-host-internal for host integration testing
        if (
          sourceLayer === 'kernel' &&
          targetLayer === 'kernel-host-internal' &&
          (filename.includes('.test.') ||
            filename.includes('.spec.') ||
            filename.includes('/__tests__/'))
        ) {
          // allowed — fall through to subpath and access checks below
        } else if (targetLayer === 'kernel-host-internal' && isHostAdapterFile(filename)) {
          // Host adapters are trusted composition roots. They may depend on the
          // private lifecycle package so higher shell/runtime code does not.
        } else if (
          sourceLayer === 'kernel-host-internal' &&
          targetLayer === 'kernel' &&
          importPath === '@mog-sdk/kernel/host-lifecycle-internal'
        ) {
          // kernel-host-internal may consume only the narrow kernel-owned friend
          // lifecycle subpath. Source deep imports remain forbidden.
        } else if (
          sourceLayer === 'shell' &&
          targetLayer === 'apps' &&
          (filename.includes('.test.') ||
            filename.includes('.spec.') ||
            filename.includes('/__tests__/'))
        ) {
          // Shell conformance tests may register real app manifests. Production
          // shell code still cannot depend on app packages.
        } else {
          context.report({
            node: source,
            messageId: 'forbiddenImport',
            data: {
              source: importPath,
              reason: forbidden.message,
              sourceLayer,
              targetLayer,
            },
          });
          return;
        }
      }

      if (importPath === '@mog-sdk/kernel/host-lifecycle-internal') {
        const isKernelHostIntegrationTest =
          sourceLayer === 'kernel' &&
          (filename.includes('.test.') ||
            filename.includes('.spec.') ||
            filename.includes('/__tests__/'));
        if (sourceLayer !== 'kernel-host-internal' && !isKernelHostIntegrationTest) {
          context.report({
            node: source,
            messageId: 'forbiddenImport',
            data: {
              source: importPath,
              reason:
                '@mog-sdk/kernel/host-lifecycle-internal is a workspace-private friend subpath. Only @mog/kernel-host-internal and kernel host integration tests may import it.',
              sourceLayer,
              targetLayer: 'kernel',
            },
          });
          return;
        }
      }

      // Check host subpath restrictions (02a)
      if (importPath.startsWith('@mog-sdk/types-host')) {
        const subpath = importPath.slice('@mog-sdk/types-host'.length) || '';

        // Test utilities (e.g. /__tests__/deterministic-test-host) are exempt when
        // imported from test files, regardless of layer.
        if (
          subpath.startsWith('/__tests__/') &&
          (filename.includes('__tests__') || filename.includes('.test.'))
        ) {
          return;
        }

        // /trusted construction internals: only allowed from named construction/test modules
        if (subpath === '/trusted' && !isTrustedSubpathAllowedFile(filename)) {
          context.report({
            node: source,
            messageId: 'forbiddenImport',
            data: {
              source: importPath,
              reason:
                'Only named construction modules, runtime facades, and test fixtures may import @mog-sdk/types-host/trusted.',
              sourceLayer,
              targetLayer: 'types',
            },
          });
          return;
        }

        // Host-adapter files are composition roots and get the same broad host
        // subpath access as runtime facades, regardless of their product layer.
        const effectiveLayer = isHostAdapterFile(filename) ? 'runtime' : sourceLayer;
        const hostRule = HOST_SUBPATH_RULES[effectiveLayer];
        if (hostRule) {
          if (hostRule.allowed.length === 0 || (subpath && !hostRule.allowed.includes(subpath))) {
            context.report({
              node: source,
              messageId: 'forbiddenImport',
              data: {
                source: importPath,
                reason: hostRule.message,
                sourceLayer,
                targetLayer: 'types',
              },
            });
            return;
          }
          if (!subpath && hostRule.allowed.length > 0) {
            context.report({
              node: source,
              messageId: 'forbiddenImport',
              data: {
                source: importPath,
                reason: hostRule.message + ' (bare import not allowed; use a specific subpath)',
                sourceLayer,
                targetLayer: 'types',
              },
            });
            return;
          }
        }
      }

      // Check: @mog/kernel-host-internal may only be imported by test-host, runtime, and dev
      if (importPath.startsWith('@mog/kernel-host-internal')) {
        const allowed = ['test-host', 'runtime', 'dev', 'kernel-host-internal'];
        if (!allowed.includes(sourceLayer) && !isHostAdapterFile(filename)) {
          // Allow kernel test files to import kernel-host-internal for integration testing
          const isTestFile =
            filename.includes('.test.') ||
            filename.includes('.spec.') ||
            filename.includes('/__tests__/');
          if (sourceLayer === 'kernel' && isTestFile) {
            // Kernel tests may import kernel-host-internal to test the host integration path
            return;
          }
          context.report({
            node: source,
            messageId: 'forbiddenImport',
            data: {
              source: importPath,
              reason:
                '@mog/kernel-host-internal is workspace-private. Only trusted adapters (runtime/test-host, runtime/*) and dev packages may import it.',
              sourceLayer,
              targetLayer: 'kernel-host-internal',
            },
          });
          return;
        }
      }

      // Check: @mog/test-host may only be imported by test files and dev packages
      if (importPath.startsWith('@mog/test-host')) {
        const isTestFile =
          filename.includes('.test.') ||
          filename.includes('.spec.') ||
          filename.includes('/__tests__/');
        if (sourceLayer !== 'dev' && sourceLayer !== 'test-host' && !isTestFile) {
          context.report({
            node: source,
            messageId: 'forbiddenImport',
            data: {
              source: importPath,
              reason:
                '@mog/test-host is a workspace-internal test package. Only test files (*.test.ts, *.spec.ts) and dev packages may import it.',
              sourceLayer,
              targetLayer: 'test-host',
            },
          });
          return;
        }
      }

      // Note: kernel -> @mog/kernel-host-internal is blocked by FORBIDDEN_IMPORTS (kernel
      // denies kernel-host-internal). Declaration-level checks preventing @mog-sdk/kernel
      // from referencing @mog-sdk/types-host are handled by API snapshot tooling.

      // Check app re-export ban:
      // Inside apps/*, `export ... from '@mog-sdk/kernel'` (etc.) is forbidden
      if (
        sourceLayer === 'apps' &&
        node.type !== 'ImportDeclaration' &&
        LOWER_LAYER_REEXPORT_PATTERNS.some((p) => p.test(importPath))
      ) {
        context.report({
          node: source,
          messageId: 'forbiddenReExport',
          data: { source: importPath },
        });
      }

      // ── runtime/embed core must not import app or shell chrome (02c-A) ─
      // Embed core (everything outside host-adapters/) should compose through
      // the adapter layer, never pull in the full spreadsheet app or shell.
      if (
        sourceLayer === 'runtime' &&
        filename.includes('runtime/embed/') &&
        !filename.includes('/host-adapters/') &&
        (importPath.startsWith('@mog/app-spreadsheet') || importPath.startsWith('@mog/shell'))
      ) {
        context.report({
          node: source,
          messageId: 'forbiddenEmbedAppImport',
          data: { source: importPath },
        });
        return;
      }

      // ── Cross-adapter deep-import ban (02c-A) ─────────────────────────
      // No adapter directory may import from another product's host-adapters/
      // via relative paths. This is mostly academic since adapters use package
      // imports, but the constraint is documented here for enforcement if
      // relative cross-adapter imports ever appear. Relative imports within
      // the same product's host-adapters/ directory are fine.
    }

    function check(node) {
      const source = node.source;
      if (!source || typeof source.value !== 'string') return;
      checkImportPath(node, source, source.value);
    }

    function checkDynamicImport(node) {
      const source = node.source;
      if (!source || source.type !== 'Literal' || typeof source.value !== 'string') return;
      checkImportPath(node, source, source.value);
    }

    function checkRequire(node) {
      if (
        node.callee?.type !== 'Identifier' ||
        node.callee.name !== 'require' ||
        node.arguments.length !== 1
      ) {
        return;
      }
      const source = node.arguments[0];
      if (source.type !== 'Literal' || typeof source.value !== 'string') return;
      checkImportPath(node, source, source.value);
    }

    // ── __TAURI__ global probe check (02c-A, rule 5) ──────────────────
    // Shell code outside designated Tauri files must not probe __TAURI__
    // or __TAURI_INTERNALS__ globals.
    function checkTauriGlobalProbe(node) {
      if (sourceLayer !== 'shell') return;

      const propName =
        node.type === 'MemberExpression' && node.property?.type === 'Identifier'
          ? node.property.name
          : null;
      const isInOperator =
        node.type === 'BinaryExpression' &&
        node.operator === 'in' &&
        node.left?.type === 'Literal' &&
        (node.left.value === '__TAURI__' || node.left.value === '__TAURI_INTERNALS__');

      // Check `window.__TAURI__` or `window.__TAURI_INTERNALS__`
      const isMemberAccess = propName === '__TAURI__' || propName === '__TAURI_INTERNALS__';

      if (!isInOperator && !isMemberAccess) return;

      const normalizedFile = filename.replace(/\\/g, '/');
      const ALLOWED_TAURI_FILES = [
        'shell/src/bootstrap/event-dispatcher.ts',
        'shell/src/hooks/use-tauri-drop-zone.ts',
        'shell/src/hooks/use-native-menu.ts',
        'shell/src/services/project/tauri-ipc.ts',
      ];
      const isAllowed =
        ALLOWED_TAURI_FILES.some((f) => normalizedFile.endsWith(f)) ||
        normalizedFile.includes('/shell/src/host-adapters/');
      if (!isAllowed) {
        context.report({
          node,
          messageId: 'forbiddenTauriGlobal',
        });
      }
    }

    // ── Cross-adapter relative import check (02c-A, rule 7) ─────────
    // Adapters in one product's host-adapters/ must not import from
    // another product's host-adapters/ via relative paths.
    function checkCrossAdapterRelativeImport(node) {
      const source = node.source;
      if (!source || typeof source.value !== 'string') return;
      const importPath = source.value;
      if (!importPath.startsWith('.')) return; // only relative imports
      if (!isHostAdapterFile(filename)) return; // only from adapter files

      // Resolve the import target relative to the source file
      const sourceDir = path.dirname(filename);
      const resolvedTarget = path.resolve(sourceDir, importPath).replace(/\\/g, '/');

      // Check if the target is in a different product's host-adapters/ directory
      if (!resolvedTarget.includes('/host-adapters/')) return;

      // Extract the product prefix for both source and target
      // e.g. shell/src/host-adapters/ vs runtime/embed/src/host-adapters/
      const sourceMatch = filename.match(/(.+?)\/host-adapters\//);
      const targetMatch = resolvedTarget.match(/(.+?)\/host-adapters\//);
      if (sourceMatch && targetMatch && sourceMatch[1] !== targetMatch[1]) {
        context.report({
          node: source,
          messageId: 'forbiddenCrossAdapterImport',
          data: { source: importPath },
        });
      }
    }

    function checkDevAppKernelInternalAlias(node) {
      const normalizedFile = filename.replace(/\\/g, '/');
      if (!normalizedFile.endsWith('/dev/app/vite.config.ts')) return;
      if (node.value !== '@mog-sdk/kernel/internal') return;
      context.report({
        node,
        messageId: 'forbiddenDevAppKernelInternalAlias',
      });
    }

    return {
      ImportDeclaration(node) {
        check(node);
        checkCrossAdapterRelativeImport(node);
      },
      ExportNamedDeclaration(node) {
        check(node);
        checkCrossAdapterRelativeImport(node);
      },
      ExportAllDeclaration(node) {
        check(node);
        checkCrossAdapterRelativeImport(node);
      },
      ImportExpression: checkDynamicImport,
      CallExpression: checkRequire,
      Literal: checkDevAppKernelInternalAlias,
      BinaryExpression: checkTauriGlobalProbe,
      MemberExpression: checkTauriGlobalProbe,
    };
  },
};
