/**
 * Package boundary conformance tests for @mog-sdk/embed.
 *
 * Verifies that:
 * 1. The root entrypoint does NOT export forbidden internal symbols.
 * 2. The package manifest exposes the Current public subpaths.
 * 3. Public subpaths stay on safe handle/config contracts.
 *
 * Strategy: For entrypoints that pull in heavy workspace deps (@mog-sdk/kernel,
 * @mog-sdk/sheet-view), we verify the barrel source text to confirm no
 * forbidden symbols are exported. For lightweight modules (config, iframe,
 * resolution), we import directly and test the runtime shape.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SRC_DIR = path.resolve(__dirname, '..');
const PACKAGE_JSON = path.resolve(SRC_DIR, '..', 'package.json');
const TSUP_CONFIG = path.resolve(SRC_DIR, '..', 'tsup.config.ts');
const LEGACY_FULL_APP_DIR = path.join(SRC_DIR, 'full-app');

/** Read the source text of a barrel file. */
function readBarrel(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_DIR, relativePath), 'utf-8');
}

/** Extract all exported names from a barrel source (handles export { ... } and export const/class/function). */
function extractExportedNames(source: string): string[] {
  const names: string[] = [];

  // Match `export { Name1, Name2 }` and `export type { Name1, Name2 }`
  const braceExportRe = /export\s+(?:type\s+)?\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = braceExportRe.exec(source)) !== null) {
    const inner = m[1];
    for (const part of inner.split(',')) {
      const token = part.replace(/\s+as\s+\w+/, '').trim();
      // Skip `type Foo` prefixed entries (type-only re-exports inside value block)
      const cleaned = token.replace(/^type\s+/, '');
      if (cleaned && !cleaned.startsWith('//')) {
        names.push(cleaned);
      }
    }
  }

  // Match `export const Name`, `export class Name`, `export function Name`, `export interface Name`, `export type Name =`
  const directExportRe = /export\s+(?:const|let|var|class|function|interface|type)\s+(\w+)/g;
  while ((m = directExportRe.exec(source)) !== null) {
    names.push(m[1]);
  }

  return names;
}

// ---------------------------------------------------------------------------
// Root entrypoint: forbidden internal leaks (source-level check)
// ---------------------------------------------------------------------------

describe('@mog-sdk/embed root entrypoint — forbidden leaks', () => {
  const rootSource = readBarrel('index.ts');
  const rootExports = extractExportedNames(rootSource);

  it('does NOT export DocumentContext', () => {
    expect(rootExports).not.toContain('DocumentContext');
  });

  it('does NOT export ComputeBridge', () => {
    expect(rootExports).not.toContain('ComputeBridge');
  });

  it('does NOT export raw provider types', () => {
    expect(rootExports).not.toContain('DocumentProvider');
    expect(rootExports).not.toContain('StorageProvider');
  });

  it('does NOT export renderer caches', () => {
    expect(rootExports).not.toContain('RenderCache');
    expect(rootExports).not.toContain('ViewportCache');
    expect(rootExports).not.toContain('TileCache');
  });

  it('exports expected public-experimental symbols', () => {
    expect(rootExports).toContain('MogSheetElement');
    expect(rootExports).toContain('SDK_VERSION');
  });

  it('does NOT export bundle-only implementation symbols', () => {
    expect(rootExports).not.toContain('MogClient');
    expect(rootExports).not.toContain('MogClientOptions');
    expect(rootExports).not.toContain('EmbedRenderOrchestrator');
    expect(rootExports).not.toContain('createEmbedRenderer');
    expect(rootExports).not.toContain('resolveEffectiveState');
    expect(rootExports).not.toContain('TrustBoundary');
    expect(rootExports).not.toContain('TrustContext');
  });

  it('exports config types', () => {
    expect(rootExports).toContain('EmbedMode');
    expect(rootExports).toContain('MogEmbedConfig');
    expect(rootExports).toContain('MogEmbedEffectiveState');
    expect(rootExports).toContain('MogEmbedHostPolicy');
    expect(rootExports).toContain('MogEmbedResolvedSource');
    expect(rootExports).toContain('MogEmbedLifecycleState');
    expect(rootExports).toContain('MogEmbedConfigValidationError');
  });

  it('does NOT export legacy raw source helpers or types', () => {
    expect(rootExports).not.toContain('EmbedSource');
    expect(rootExports).not.toContain('sourceRefFromLegacy');
  });

  it('does NOT export raw workbook, worksheet, or viewport types', () => {
    expect(rootExports).not.toContain('CellFormat');
    expect(rootExports).not.toContain('CellData');
    expect(rootExports).not.toContain('Workbook');
    expect(rootExports).not.toContain('Worksheet');
    expect(rootExports).not.toContain('ViewportRegion');
    expect(rootExports).not.toContain('WorkbookViewport');
    expect(rootExports).not.toContain('WorkbookViewportBounds');
  });
});

// ---------------------------------------------------------------------------
// React entrypoint: public handle shape
// ---------------------------------------------------------------------------

describe('@mog-sdk/embed/react entrypoint — public handle', () => {
  const reactSource = readBarrel('react/index.tsx');
  const reactExports = extractExportedNames(reactSource);
  const handleSource =
    reactSource.match(/export interface MogSheetHandle \{[\s\S]*?\n\}/)?.[0] ?? '';

  it('exports the React component and public types', () => {
    expect(reactExports).toContain('MogSheet');
    expect(reactExports).toContain('MogSheetHandle');
    expect(reactExports).toContain('MogSheetProps');
  });

  it('does NOT expose raw workbook or worksheet accessors on the handle', () => {
    expect(handleSource).not.toMatch(/\bgetWorkbook\s*\(/);
    expect(handleSource).not.toMatch(/\bgetActiveSheet\s*\(/);
    expect(handleSource).not.toMatch(/\bWorkbook\b/);
    expect(handleSource).not.toMatch(/\bWorksheet\b/);
    expect(reactSource).not.toMatch(
      /\bimport type \{[^}]*Workbook[^}]*\} from ['"]\.\.\/types['"]/s,
    );
    expect(reactSource).not.toMatch(
      /\bimport type \{[^}]*Worksheet[^}]*\} from ['"]\.\.\/types['"]/s,
    );
  });

  it('requires host policy resolution and rejects public raw src props', () => {
    expect(reactSource).toMatch(/\bhostPolicy:\s*MogEmbedHostPolicy\b/);
    expect(reactSource).toMatch(/\bconfig:\s*MogEmbedConfig\b/);
    expect(reactSource).toMatch(/\bsrc\?:\s*never\b/);
    expect(reactSource).not.toMatch(/\bsrc:\s*string\s*\|\s*ArrayBuffer\s*\|\s*Uint8Array\b/);
  });

  it('does not synthesize effective state from requested capabilities/save/collaboration', () => {
    expect(reactSource).toMatch(/\bresolveEffectiveState\b/);
    expect(reactSource).not.toMatch(/capabilities:\s*config\?\.requestedCapabilities/);
    expect(reactSource).not.toMatch(/savePolicy:\s*config\?\.requestedSavePolicy/);
    expect(reactSource).not.toMatch(/collaboration:\s*config\?\.requestedCollaboration/);
  });

  it('boots through the React host adapter instead of constructing MogClient directly', () => {
    expect(reactSource).toMatch(/\bcreateReactEmbedHost\b/);
    expect(reactSource).not.toMatch(/\bnew\s+MogClient\b/);
    expect(reactSource).not.toMatch(/from ['"]\.\.\/client\/index['"]/);
  });

  it('gates save and export through effective-state adapter checks', () => {
    expect(reactSource).toMatch(/\bcanRequestSave\b/);
    expect(reactSource).toMatch(/\bcanRequestExport\b/);
    expect(reactSource).not.toMatch(/if\s*\([^)]*!hostPolicy\.requestSave/);
    expect(reactSource).not.toMatch(/if\s*\([^)]*!hostPolicy\.requestExport/);
  });
});

// ---------------------------------------------------------------------------
// Package manifest export map
// ---------------------------------------------------------------------------

describe('@mog-sdk/embed package exports', () => {
  const manifest = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf-8')) as {
    exports: Record<string, unknown>;
  };

  it('exposes only the Current public subpaths', () => {
    expect(Object.keys(manifest.exports).sort()).toEqual([
      '.',
      './config',
      './internal/views-host',
      './react',
      './web-component',
    ]);
  });

  it('exposes views-host only as a classified internal friend subpath', () => {
    expect(manifest.exports['./internal/views-host']).toEqual({
      types: './dist/internal/views-host.d.ts',
      import: './dist/internal/views-host.js',
      require: './dist/internal/views-host.cjs',
    });
  });

  it('keeps bundle-private and reserved products out of package.exports', () => {
    for (const subpath of ['./client', './iframe', './full-app', './publish']) {
      expect(manifest.exports).not.toHaveProperty(subpath);
    }
  });

  it('does not keep the deleted full-app prototype source around as a shadow surface', () => {
    expect(fs.existsSync(LEGACY_FULL_APP_DIR)).toBe(false);
  });

  it('does not emit reserved full-app, iframe, or publish bundles', () => {
    const config = fs.readFileSync(TSUP_CONFIG, 'utf-8');
    expect(config).not.toMatch(/['"]full-app['"]\s*:\s*['"]src\/full-app\/index\.ts['"]/);
    expect(config).not.toMatch(/\biframe\s*:\s*['"]src\/iframe\/index\.ts['"]/);
    expect(config).not.toMatch(/\bpublish\s*:\s*['"]src\/publish\/index\.ts['"]/);
  });
});

// ---------------------------------------------------------------------------
// Bundled client: source loading stays host-authorized
// ---------------------------------------------------------------------------

describe('@mog-sdk/embed bundled client source path', () => {
  const clientSource = readBarrel('client/index.ts');

  it('does not fetch arbitrary string sources', () => {
    expect(clientSource).not.toMatch(/\bfetch\s*\(/);
    expect(clientSource).not.toMatch(/source\?:\s*ArrayBuffer\s*\|\s*Uint8Array\s*\|\s*string/);
    expect(clientSource).toMatch(/sourceBytes:\s*ArrayBuffer\s*\|\s*Uint8Array/);
  });

  it('does not import public declarations from raw workbook contracts', () => {
    expect(clientSource).not.toMatch(/@mog-sdk\/spreadsheet-contracts/);
    expect(clientSource).not.toMatch(/\bexport\s+type\s+\{[^}]*Workbook/s);
    expect(clientSource).toMatch(/\binterface MogClientWorkbookHandle\b/);
    expect(clientSource).toMatch(/\binterface MogClientWorksheet\b/);
  });
});

// ---------------------------------------------------------------------------
// Web-component subpath: source-level check
// ---------------------------------------------------------------------------

describe('@mog-sdk/embed/web-component subpath', () => {
  const source = readBarrel('web-component/index.ts');
  const elementSource = readBarrel('mog-sheet-element.ts');
  const exports = extractExportedNames(source);

  it('exports the custom element, config types, and config validation helpers only', () => {
    expect(exports).toEqual([
      'MogSheetElement',
      'EmbedMode',
      'MogEmbedConfig',
      'MogEmbedEffectiveState',
      'MogEmbedResolvedSource',
      'MogEmbedHostPolicy',
      'MogEmbedLifecycleState',
      'MogEmbedEventMap',
      'MogEmbedConfigValidationError',
      'validateMogEmbedConfig',
      'assertValidMogEmbedConfig',
    ]);
  });

  it('does not expose a typed public raw src property', () => {
    expect(elementSource).not.toMatch(/\bget src\(/);
    expect(elementSource).not.toMatch(/\bset src\(/);
    expect(elementSource).toMatch(/Raw src attributes are no longer accepted/);
    expect(elementSource).toMatch(/\bget hostPolicy\(\):\s*MogEmbedHostPolicy\s*\|\s*null/);
  });

  it('boots through the web-component host adapter instead of constructing MogClient directly', () => {
    expect(elementSource).toMatch(/\bcreateWebComponentEmbedHost\b/);
    expect(elementSource).not.toMatch(/\bnew\s+MogClient\b/);
    expect(elementSource).not.toMatch(/from ['"]\.\/client\/index['"]/);
  });

  it('gates save and export through effective-state adapter checks', () => {
    expect(elementSource).toMatch(/\bcanRequestSave\b/);
    expect(elementSource).toMatch(/\bcanRequestExport\b/);
    expect(elementSource).not.toMatch(/if\s*\([^)]*!this\._hostPolicy\?\.requestSave/);
    expect(elementSource).not.toMatch(/if\s*\([^)]*!this\._hostPolicy\?\.requestExport/);
  });
});

// ---------------------------------------------------------------------------
// Config subpath (lightweight — can import directly)
// ---------------------------------------------------------------------------

import * as config from '../config';

describe('@mog-sdk/embed/config subpath', () => {
  it('exports only runtime validation helpers', () => {
    const keys = Object.keys(config);
    const runtimeExports = keys.filter(
      (k) => typeof (config as Record<string, unknown>)[k] !== 'undefined',
    );
    expect(runtimeExports.sort()).toEqual(['assertValidMogEmbedConfig', 'validateMogEmbedConfig']);
  });

  it('does NOT export DocumentContext, ComputeBridge, or provider types', () => {
    expect((config as Record<string, unknown>).DocumentContext).toBeUndefined();
    expect((config as Record<string, unknown>).ComputeBridge).toBeUndefined();
    expect((config as Record<string, unknown>).DocumentProvider).toBeUndefined();
  });
});
