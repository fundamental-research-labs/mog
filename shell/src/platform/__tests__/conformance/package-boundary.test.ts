/**
 * Conformance tests — package boundary validation.
 */

import { TASK_TRACKER_MANIFEST } from '../fixtures/task-tracker-manifest';

import { createPackageBoundaryValidator } from '../../package-boundary-validator';

describe('Package Boundary', () => {
  const validator = createPackageBoundaryValidator();

  it('task tracker imports only @mog/shell/platform — passes boundary check', () => {
    const imports = ['@mog/shell/platform'];
    const result = validator.validateAppImports(TASK_TRACKER_MANIFEST, imports);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('hypothetical app importing @mog/shell/host — fails boundary check', () => {
    const imports = ['@mog/shell/platform', '@mog/shell/host'];
    const result = validator.validateAppImports(TASK_TRACKER_MANIFEST, imports);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].path).toBe('@mog/shell/host');
  });

  it('hypothetical app importing @mog-sdk/contracts — fails boundary check', () => {
    const imports = ['@mog/shell/platform', '@mog-sdk/contracts'];
    const result = validator.validateAppImports(TASK_TRACKER_MANIFEST, imports);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].path).toBe('@mog-sdk/contracts');
  });

  it('ordinary external packages are allowed', () => {
    const imports = ['@mog/shell/platform', 'react', '@tanstack/react-query'];
    const result = validator.validateAppImports(TASK_TRACKER_MANIFEST, imports);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});
