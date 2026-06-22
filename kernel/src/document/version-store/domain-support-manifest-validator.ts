// VC-06A: Fail-closed validator for the DomainSupportManifest.
//
// Durable version-control operations (commit/checkout/merge/import) must NOT
// proceed on a manifest that is missing, stale, or structurally incomplete. The
// validator encodes that as a pure function whose defaults are fail-closed: any
// missing/unknown/stale input produces `{ ok: false, diagnostics }` rather than
// silently degrading. Callers gate durable writes on `ok === true`.
//
// This module is intentionally self-contained and not wired into the live write
// path; VC-06 / VC-04 own that integration. It exists so the fail-closed
// contract can be specified and tested ahead of Batch B promotion.

import {
  VERSION_DOMAIN_CAPABILITY_KEYS,
  VERSION_DOMAIN_CAPABILITY_STATES,
  VERSION_DOMAIN_CLASSES,
  type DomainCapabilityPolicyManifest,
  type DomainSupportManifest,
  type VersionDomainCapabilityState,
  type VersionDomainClass,
} from '@mog-sdk/contracts/versioning';

/**
 * Schema versions this validator understands. A manifest tagged with anything
 * outside this set is rejected (fail-closed) rather than best-effort parsed.
 */
export const SUPPORTED_DOMAIN_SUPPORT_MANIFEST_SCHEMA_VERSIONS = Object.freeze([
  '1',
  'domain-support-manifest.v1',
] as const);

/**
 * First-slice domains that MUST be present in every manifest before a durable
 * operation can proceed. A manifest that omits any of these fails closed: we
 * cannot prove coverage for a domain we have no row for. Kept in sync with the
 * coverage matrix / BatchBDomainInventory first-slice set.
 */
export const REQUIRED_FIRST_SLICE_DOMAIN_IDS = Object.freeze([
  'workbook-metadata',
  'sheets',
  'rows-columns',
  'cells.values',
  'cells.formulas',
  'recalc-caches',
] as const);

export type DomainSupportManifestDiagnosticCode =
  | 'schema-version-missing'
  | 'schema-version-unsupported'
  | 'manifest-malformed'
  | 'generated-at-missing'
  | 'generated-at-malformed'
  | 'manifest-stale'
  | 'domains-missing'
  | 'required-domain-missing'
  | 'duplicate-domain'
  | 'domain-malformed'
  | 'unknown-domain-class'
  | 'capability-states-missing'
  | 'capability-state-missing'
  | 'unknown-capability-key'
  | 'unknown-capability-state'
  | 'detector-row-missing';

export interface DomainSupportManifestDiagnostic {
  readonly code: DomainSupportManifestDiagnosticCode;
  readonly message: string;
  /** Domain the diagnostic applies to, when domain-scoped. */
  readonly domainId?: string;
}

export interface DomainSupportManifestValidationOk {
  readonly ok: true;
  /** Domain ids that carry a present detector row, for caller convenience. */
  readonly presentDomainIds: readonly string[];
}

export interface DomainSupportManifestValidationFailure {
  readonly ok: false;
  readonly diagnostics: readonly DomainSupportManifestDiagnostic[];
}

export type DomainSupportManifestValidationResult =
  | DomainSupportManifestValidationOk
  | DomainSupportManifestValidationFailure;

/**
 * A detector row keyed by domain. Presence of a row asserts the manifest claims
 * the domain is present in the workbook; a present domain with no detector row
 * is a fail-closed condition (we cannot classify what the detector saw).
 *
 * This is a minimal additive shape used only by the validator. It is NOT a
 * shared public contract; it exists so the validator can express "a detector
 * row must exist for a present domain" without depending on the full
 * DomainPresenceDetector wiring that VC-06 owns.
 */
export interface DomainSupportDetectorRow {
  readonly domainId: string;
  /** True when the detector observed the domain present in the workbook. */
  readonly present: boolean;
  /** The detector that produced this row. */
  readonly detectorId?: string;
}

export interface DomainSupportManifestValidationOptions {
  /**
   * Current time used for staleness comparison. Required for fail-closed
   * staleness checks; if omitted, staleness cannot be proven and is skipped,
   * but the caller should always supply it for durable operations.
   */
  readonly now?: Date;
  /**
   * Maximum age in milliseconds before a manifest is considered stale. When
   * provided together with `now`, a manifest whose `generatedAt` is older than
   * `now - maxAgeMs` fails closed.
   */
  readonly maxAgeMs?: number;
  /**
   * An explicit lower bound: manifests generated strictly before this instant
   * are stale regardless of `maxAgeMs` (e.g. an engine-upgrade / schema
   * checkpoint boundary). Fail-closed when violated.
   */
  readonly minGeneratedAt?: Date;
  /**
   * Override the required first-slice domain set. Defaults to
   * REQUIRED_FIRST_SLICE_DOMAIN_IDS. A manifest missing any required id fails.
   */
  readonly requiredDomainIds?: readonly string[];
  /**
   * Detector rows observed for this workbook. When supplied, every domain whose
   * detector row is `present: true` must also have a matching policy row in the
   * manifest, otherwise the detector-row-missing fail-closed condition fires.
   */
  readonly detectorRows?: readonly DomainSupportDetectorRow[];
}

const CLASS_SET: ReadonlySet<string> = new Set(VERSION_DOMAIN_CLASSES);
const CAPABILITY_KEY_SET: ReadonlySet<string> = new Set(VERSION_DOMAIN_CAPABILITY_KEYS);
const STATE_SET: ReadonlySet<string> = new Set(VERSION_DOMAIN_CAPABILITY_STATES);

function isVersionDomainClass(value: unknown): value is VersionDomainClass {
  return typeof value === 'string' && CLASS_SET.has(value);
}

function isVersionDomainCapabilityState(value: unknown): value is VersionDomainCapabilityState {
  return typeof value === 'string' && STATE_SET.has(value);
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSupportedSchemaVersion(value: string): boolean {
  return (SUPPORTED_DOMAIN_SUPPORT_MANIFEST_SCHEMA_VERSIONS as readonly string[]).includes(value);
}

function validateCapabilityStates(
  domainId: string,
  capabilityStates: unknown,
  diagnostics: DomainSupportManifestDiagnostic[],
): void {
  if (!isPlainRecord(capabilityStates)) {
    diagnostics.push({
      code: 'capability-states-missing',
      message: `Domain "${domainId}" must provide capabilityStates keyed by version capability.`,
      domainId,
    });
    return;
  }

  for (const key of Object.keys(capabilityStates)) {
    if (!CAPABILITY_KEY_SET.has(key)) {
      diagnostics.push({
        code: 'unknown-capability-key',
        message: `Domain "${domainId}" references unknown capability key "${key}".`,
        domainId,
      });
    }
  }

  for (const key of VERSION_DOMAIN_CAPABILITY_KEYS) {
    const state = capabilityStates[key];
    if (state === undefined) {
      diagnostics.push({
        code: 'capability-state-missing',
        message: `Domain "${domainId}" is missing capability state for "${key}".`,
        domainId,
      });
      continue;
    }
    if (!isVersionDomainCapabilityState(state)) {
      diagnostics.push({
        code: 'unknown-capability-state',
        message: `Domain "${domainId}" capability "${key}" references unknown state "${String(state)}".`,
        domainId,
      });
    }
  }
}

/**
 * Pure, fail-closed validation of a DomainSupportManifest.
 *
 * Returns `{ ok: true }` only for a well-formed, fresh, complete manifest.
 * Otherwise returns `{ ok: false, diagnostics }`. The function never throws on
 * a structurally invalid manifest — malformed input is reported as a
 * diagnostic — so callers can treat any non-`ok` result as a hard block.
 */
export function validateDomainSupportManifest(
  manifest: DomainSupportManifest | unknown,
  options: DomainSupportManifestValidationOptions = {},
): DomainSupportManifestValidationResult {
  const diagnostics: DomainSupportManifestDiagnostic[] = [];

  // --- structural shape ---------------------------------------------------
  if (manifest === null || typeof manifest !== 'object') {
    return {
      ok: false,
      diagnostics: [
        { code: 'manifest-malformed', message: 'Manifest is not an object.' },
      ],
    };
  }

  const candidate = manifest as Partial<DomainSupportManifest>;

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

  // --- domain rows --------------------------------------------------------
  const domains = candidate.domains;
  const presentDomainIds: string[] = [];
  if (!Array.isArray(domains)) {
    diagnostics.push({
      code: 'domains-missing',
      message: 'Manifest domains must be an array.',
    });
  } else {
    const seen = new Set<string>();
    for (let index = 0; index < domains.length; index += 1) {
      const row = domains[index] as Partial<DomainCapabilityPolicyManifest> | unknown;
      if (row === null || typeof row !== 'object') {
        diagnostics.push({
          code: 'domain-malformed',
          message: `Domain row at index ${index} is not an object.`,
        });
        continue;
      }
      const typed = row as Partial<DomainCapabilityPolicyManifest>;
      const domainId = typed.domainId;
      if (typeof domainId !== 'string' || domainId === '') {
        diagnostics.push({
          code: 'domain-malformed',
          message: `Domain row at index ${index} has a missing or empty domainId.`,
        });
        continue;
      }
      if (seen.has(domainId)) {
        diagnostics.push({
          code: 'duplicate-domain',
          message: `Domain "${domainId}" appears more than once.`,
          domainId,
        });
        continue;
      }
      seen.add(domainId);
      presentDomainIds.push(domainId);

      if (!isVersionDomainClass(typed.domainClass)) {
        diagnostics.push({
          code: 'unknown-domain-class',
          message: `Domain "${domainId}" references unknown domainClass "${String(typed.domainClass)}".`,
          domainId,
        });
      }
      validateCapabilityStates(domainId, typed.capabilityStates, diagnostics);
      if (
        typed.capabilityState !== undefined &&
        !isVersionDomainCapabilityState(typed.capabilityState)
      ) {
        diagnostics.push({
          code: 'unknown-capability-state',
          message: `Domain "${domainId}" references unknown legacy capabilityState "${String(typed.capabilityState)}".`,
          domainId,
        });
      }
    }

    // --- required first-slice coverage ------------------------------------
    const required = options.requiredDomainIds ?? REQUIRED_FIRST_SLICE_DOMAIN_IDS;
    for (const requiredId of required) {
      if (!seen.has(requiredId)) {
        diagnostics.push({
          code: 'required-domain-missing',
          message: `Required first-slice domain "${requiredId}" is absent from the manifest.`,
          domainId: requiredId,
        });
      }
    }

    // --- detector row coverage: a present domain needs a policy row -------
    if (options.detectorRows) {
      for (const detector of options.detectorRows) {
        if (detector.present && !seen.has(detector.domainId)) {
          diagnostics.push({
            code: 'detector-row-missing',
            message: `Domain "${detector.domainId}" was detected present but has no policy row in the manifest.`,
            domainId: detector.domainId,
          });
        }
      }
    }
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  return { ok: true, presentDomainIds };
}

/**
 * Typed error for callers that prefer throw-based control flow. Carries the
 * structured diagnostics so the boundary can still log/redact them.
 */
export class DomainSupportManifestError extends Error {
  readonly diagnostics: readonly DomainSupportManifestDiagnostic[];

  constructor(diagnostics: readonly DomainSupportManifestDiagnostic[]) {
    const codes = diagnostics.map((d) => d.code).join(', ');
    super(`DomainSupportManifest failed validation (fail-closed): ${codes}`);
    this.name = 'DomainSupportManifestError';
    this.diagnostics = diagnostics;
  }
}

/**
 * Fail-closed assertion wrapper. Returns the validated manifest's present
 * domain ids on success, throws DomainSupportManifestError otherwise. Use this
 * at a durable-operation boundary that must not proceed on a bad manifest.
 */
export function assertDomainSupportManifest(
  manifest: DomainSupportManifest | unknown,
  options: DomainSupportManifestValidationOptions = {},
): readonly string[] {
  const result = validateDomainSupportManifest(manifest, options);
  if (!result.ok) {
    throw new DomainSupportManifestError(result.diagnostics);
  }
  return result.presentDomainIds;
}
