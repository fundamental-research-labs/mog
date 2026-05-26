/**
 * Manifest Validation
 *
 * Structural and compatibility validation for app manifests.
 *
 */

import type { AppManifest, ValidationResult, ValidationIssue, RuntimeHostMode } from './types';
import { validateManifest } from './manifest-validator';

/**
 * Validate manifest structural correctness at registration time.
 */
export function validateAppManifest(manifest: AppManifest): ValidationResult {
  const issues: ValidationIssue[] = validateManifest(
    manifest as unknown as Record<string, unknown>,
  ).map((error) => ({
    path: error.field,
    message: error.message,
    severity: 'error' as const,
  }));

  return {
    valid: issues.every((i) => i.severity !== 'error'),
    issues,
  };
}

/**
 * Validate runtime host compatibility at enable time.
 * only same-realm-first-party is supported.
 */
export function validateRuntimeHostCompatibility(
  runtimeHost: RuntimeHostMode | undefined,
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // only same-realm-first-party is supported
  if (runtimeHost && runtimeHost !== 'same-realm-first-party') {
    issues.push({
      path: 'runtimeHost',
      message: `Runtime host mode '${runtimeHost}' is not supported in current implementation. Only 'same-realm-first-party' is allowed.`,
      severity: 'error',
    });
  }

  return {
    valid: issues.every((i) => i.severity !== 'error'),
    issues,
  };
}
