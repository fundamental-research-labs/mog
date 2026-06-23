import type { DomainSupportManifest } from '@mog-sdk/contracts/versioning';

import { SUPPORTED_DOMAIN_SUPPORT_MANIFEST_SCHEMA_VERSIONS } from './domain-support-manifest-validator-constants';
import type {
  DomainSupportManifestDiagnostic,
  DomainSupportManifestValidationOptions,
} from './domain-support-manifest-validator-types';

function isSupportedSchemaVersion(value: string): boolean {
  return (SUPPORTED_DOMAIN_SUPPORT_MANIFEST_SCHEMA_VERSIONS as readonly string[]).includes(value);
}

export function validateManifestMetadata(
  candidate: Partial<DomainSupportManifest>,
  options: DomainSupportManifestValidationOptions,
  diagnostics: DomainSupportManifestDiagnostic[],
): void {
  // --- schema version (fail-closed on missing/unsupported) ----------------
  const schemaVersion = candidate.schemaVersion;
  if (schemaVersion === undefined || schemaVersion === null || schemaVersion === '') {
    diagnostics.push({
      code: 'schema-version-missing',
      message: 'Manifest schemaVersion is missing.',
    });
  } else if (typeof schemaVersion !== 'string' || !isSupportedSchemaVersion(schemaVersion)) {
    diagnostics.push({
      code: 'schema-version-unsupported',
      message: `Manifest schemaVersion "${String(schemaVersion)}" is not supported. Supported: ${SUPPORTED_DOMAIN_SUPPORT_MANIFEST_SCHEMA_VERSIONS.join(', ')}.`,
    });
  }

  // --- freshness (fail-closed on missing/malformed/stale) -----------------
  const generatedAtRaw = candidate.generatedAt;
  let generatedAt: number | undefined;
  if (generatedAtRaw === undefined || generatedAtRaw === null || generatedAtRaw === '') {
    diagnostics.push({
      code: 'generated-at-missing',
      message: 'Manifest generatedAt is missing.',
    });
  } else if (typeof generatedAtRaw !== 'string') {
    diagnostics.push({
      code: 'generated-at-malformed',
      message: 'Manifest generatedAt must be an ISO-8601 string.',
    });
  } else {
    const parsed = Date.parse(generatedAtRaw);
    if (Number.isNaN(parsed)) {
      diagnostics.push({
        code: 'generated-at-malformed',
        message: `Manifest generatedAt "${generatedAtRaw}" is not a valid date.`,
      });
    } else {
      generatedAt = parsed;
    }
  }

  if (generatedAt !== undefined) {
    if (options.minGeneratedAt instanceof Date && generatedAt < options.minGeneratedAt.getTime()) {
      diagnostics.push({
        code: 'manifest-stale',
        message: `Manifest generatedAt is older than the required lower bound ${options.minGeneratedAt.toISOString()}.`,
      });
    }
    if (
      options.now instanceof Date &&
      typeof options.maxAgeMs === 'number' &&
      Number.isFinite(options.maxAgeMs)
    ) {
      const ageMs = options.now.getTime() - generatedAt;
      if (ageMs > options.maxAgeMs) {
        diagnostics.push({
          code: 'manifest-stale',
          message: `Manifest is ${ageMs}ms old, exceeding the maximum allowed age of ${options.maxAgeMs}ms.`,
        });
      }
    }
  }
}
