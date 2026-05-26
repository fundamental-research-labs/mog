/**
 * Tests for PackageBoundaryValidator
 */

import { createPackageBoundaryValidator } from '../package-boundary-validator';
import type { AppManifest, PluginManifest } from '../types';

// =============================================================================
// Fixtures
// =============================================================================

const manifest: AppManifest = {
  id: 'third-party-app',
  name: 'Third Party',
  version: '1.0.0',
  runtimeHost: 'iframe-sandbox',
};

const pluginManifest: PluginManifest = {
  id: 'third-party-plugin' as any,
  name: 'Third Party Plugin',
  version: '1.0.0',
  isolation: 'worker-sandbox',
};

// =============================================================================
// Tests
// =============================================================================

describe('PackageBoundaryValidator', () => {
  const validator = createPackageBoundaryValidator();

  describe('valid imports', () => {
    it('allows @mog-sdk/types-app-platform imports', () => {
      const result = validator.validateAppImports(manifest, [
        '@mog-sdk/types-app-platform',
        '@mog-sdk/types-app-platform/plugin',
        '@mog-sdk/types-app-platform/manifest/types',
      ]);
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('allows @mog-sdk/types-document imports', () => {
      const result = validator.validateAppImports(manifest, [
        '@mog-sdk/types-document',
        '@mog-sdk/types-document/security/types',
      ]);
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('allows non-mog imports', () => {
      const result = validator.validateAppImports(manifest, [
        'react',
        'lodash',
        '@tanstack/react-query',
      ]);
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe('forbidden imports', () => {
    it('rejects @mog/shell internal imports', () => {
      const result = validator.validateAppImports(manifest, [
        '@mog/shell/hooks',
        '@mog/shell/context',
      ]);
      expect(result.valid).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(result.violations[0].reason).toContain('Shell internals');
    });

    it('rejects @mog/app-* internal imports', () => {
      const result = validator.validateAppImports(manifest, [
        '@mog/app-spreadsheet/utils',
        '@mog/app-crm/models',
      ]);
      expect(result.valid).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(result.violations[0].reason).toContain('App-specific internals');
    });

    it('rejects @mog-sdk/kernel internal imports', () => {
      const result = validator.validateAppImports(manifest, [
        '@mog-sdk/kernel/services/capabilities',
        '@mog-sdk/kernel/context',
      ]);
      expect(result.valid).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(result.violations[0].reason).toContain('Kernel internals');
    });

    it('rejects @mog-sdk/contracts imports', () => {
      const result = validator.validateAppImports(manifest, [
        '@mog-sdk/contracts/capabilities',
        '@mog-sdk/contracts/core',
      ]);
      expect(result.valid).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(result.violations[0].reason).toContain('Spreadsheet-specific');
    });
  });

  describe('mixed imports', () => {
    it('reports only violations for mixed valid/invalid imports', () => {
      const result = validator.validateAppImports(manifest, [
        '@mog-sdk/types-app-platform/plugin',
        '@mog/shell/hooks',
        'react',
        '@mog-sdk/kernel/internal',
      ]);
      expect(result.valid).toBe(false);
      expect(result.violations).toHaveLength(2);
    });
  });

  describe('plugin imports', () => {
    it('validates plugin imports the same way', () => {
      const validResult = validator.validatePluginImports(pluginManifest, [
        '@mog-sdk/types-app-platform/trust',
        '@mog/shell/platform',
      ]);
      expect(validResult.valid).toBe(true);

      const invalidResult = validator.validatePluginImports(pluginManifest, ['@mog/shell/host']);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.violations).toHaveLength(1);
    });
  });
});
