import type { AppManifest } from './types';

// ─── Validation Result ───────────────────────────────────────────────────────

/** Severity of a validation diagnostic. */
export type ValidationSeverity = 'error' | 'warning';

/** A single validation diagnostic. */
export interface ValidationDiagnostic {
  /** Severity level. */
  readonly severity: ValidationSeverity;
  /** Machine-readable error code. */
  readonly code: string;
  /** Human-readable message. */
  readonly message: string;
  /** JSON-path to the offending field, if applicable. */
  readonly path?: string;
}

/** Result of manifest validation. */
export interface ValidationResult {
  /** Whether the manifest is structurally valid (no errors). */
  readonly valid: boolean;
  /** Error diagnostics that prevent use. */
  readonly errors: readonly ValidationDiagnostic[];
  /** Warning diagnostics that do not prevent use. */
  readonly warnings: readonly ValidationDiagnostic[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function diag(
  severity: ValidationSeverity,
  code: string,
  message: string,
  path?: string,
): ValidationDiagnostic {
  return { severity, code, message, path };
}

const APP_ID_RE = /^[a-z][a-z0-9._-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+/;

// ─── Validator ───────────────────────────────────────────────────────────────

/** Structurally validate an app manifest, returning errors and warnings. */
export function validateAppManifest(manifest: unknown): ValidationResult {
  const errors: ValidationDiagnostic[] = [];
  const warnings: ValidationDiagnostic[] = [];

  if (manifest == null || typeof manifest !== 'object') {
    errors.push(diag('error', 'MANIFEST_NOT_OBJECT', 'Manifest must be a non-null object'));
    return { valid: false, errors, warnings };
  }

  const m = manifest as Record<string, unknown>;

  // Required string fields
  const requiredStrings: [string, string][] = [
    ['id', 'MISSING_ID'],
    ['name', 'MISSING_NAME'],
    ['version', 'MISSING_VERSION'],
    ['description', 'MISSING_DESCRIPTION'],
    ['author', 'MISSING_AUTHOR'],
    ['icon', 'MISSING_ICON'],
    ['kind', 'MISSING_KIND'],
    ['runtimeHost', 'MISSING_RUNTIME_HOST'],
  ];

  for (const [field, code] of requiredStrings) {
    if (typeof m[field] !== 'string' || (m[field] as string).length === 0) {
      errors.push(diag('error', code, `"${field}" must be a non-empty string`, field));
    }
  }

  // ID format
  if (typeof m['id'] === 'string' && !APP_ID_RE.test(m['id'] as string)) {
    errors.push(
      diag('error', 'INVALID_ID_FORMAT', 'App ID must match /^[a-z][a-z0-9._-]*$/', 'id'),
    );
  }

  // Version format
  if (typeof m['version'] === 'string' && !SEMVER_RE.test(m['version'] as string)) {
    errors.push(
      diag('error', 'INVALID_VERSION', 'Version must be a valid semver string', 'version'),
    );
  }

  // Kind enum
  const validKinds = [
    'document-app',
    'dataset-app',
    'workspace-app',
    'utility-app',
    'background-app',
  ];
  if (typeof m['kind'] === 'string' && !validKinds.includes(m['kind'] as string)) {
    errors.push(
      diag('error', 'INVALID_KIND', `Kind must be one of: ${validKinds.join(', ')}`, 'kind'),
    );
  }

  // RuntimeHost enum
  const validHosts = [
    'same-realm-first-party',
    'iframe-sandbox',
    'worker-sandbox',
    'server-side',
    'remote-bridge',
    'disabled',
  ];
  if (typeof m['runtimeHost'] === 'string' && !validHosts.includes(m['runtimeHost'] as string)) {
    errors.push(
      diag(
        'error',
        'INVALID_RUNTIME_HOST',
        `runtimeHost must be one of: ${validHosts.join(', ')}`,
        'runtimeHost',
      ),
    );
  }

  // Entry
  if (m['entry'] == null || typeof m['entry'] !== 'object') {
    errors.push(
      diag('error', 'MISSING_ENTRY', 'Entry must be an object with a "module" field', 'entry'),
    );
  } else {
    const entry = m['entry'] as Record<string, unknown>;
    if (typeof entry['module'] !== 'string' || (entry['module'] as string).length === 0) {
      errors.push(
        diag(
          'error',
          'MISSING_ENTRY_MODULE',
          'Entry must have a non-empty "module" string',
          'entry.module',
        ),
      );
    }
  }

  // Compatibility (array)
  if (!Array.isArray(m['compatibility'])) {
    errors.push(
      diag('error', 'MISSING_COMPATIBILITY', 'Compatibility must be an array', 'compatibility'),
    );
  }

  // Capabilities (array)
  if (!Array.isArray(m['capabilities'])) {
    errors.push(
      diag('error', 'MISSING_CAPABILITIES', 'Capabilities must be an array', 'capabilities'),
    );
  }

  // Routes (array)
  if (!Array.isArray(m['routes'])) {
    errors.push(diag('error', 'MISSING_ROUTES', 'Routes must be an array', 'routes'));
  } else {
    const paths = new Set<string>();
    for (let i = 0; i < (m['routes'] as unknown[]).length; i++) {
      const route = (m['routes'] as Record<string, unknown>[])[i];
      if (route && typeof route['path'] === 'string') {
        if (paths.has(route['path'] as string)) {
          errors.push(
            diag(
              'error',
              'DUPLICATE_ROUTE',
              `Duplicate route path: "${route['path']}"`,
              `routes[${i}].path`,
            ),
          );
        }
        paths.add(route['path'] as string);
      }
    }
  }

  // Contributions — check for duplicate IDs
  if (Array.isArray(m['contributions'])) {
    const ids = new Set<string>();
    for (let i = 0; i < (m['contributions'] as unknown[]).length; i++) {
      const contrib = (m['contributions'] as Record<string, unknown>[])[i];
      if (contrib && typeof contrib['id'] === 'string') {
        if (ids.has(contrib['id'] as string)) {
          errors.push(
            diag(
              'error',
              'DUPLICATE_CONTRIBUTION_ID',
              `Duplicate contribution ID: "${contrib['id']}"`,
              `contributions[${i}].id`,
            ),
          );
        }
        ids.add(contrib['id'] as string);
      }
    }
  } else {
    errors.push(
      diag('error', 'MISSING_CONTRIBUTIONS', 'Contributions must be an array', 'contributions'),
    );
  }

  // Data
  if (m['data'] == null || typeof m['data'] !== 'object') {
    errors.push(diag('error', 'MISSING_DATA', 'Data must be an object', 'data'));
  }

  // Lifecycle
  if (m['lifecycle'] == null || typeof m['lifecycle'] !== 'object') {
    errors.push(diag('error', 'MISSING_LIFECYCLE', 'Lifecycle must be an object', 'lifecycle'));
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Type guard that narrows unknown to AppManifest when validation passes. */
export function isValidAppManifest(manifest: unknown): manifest is AppManifest {
  return validateAppManifest(manifest).valid;
}
