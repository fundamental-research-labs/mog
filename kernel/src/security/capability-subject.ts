/**
 * Capability Subject Model
 *
 * Replaces bare AppId as the authorization subject. A CapabilitySubject
 * is a multi-field principal that can represent an app, a plugin within
 * an app, a specific instance, or a workspace/tenant-scoped binding.
 *
 * Grant matching rule: every field that is SET on the grant must match
 * the corresponding field on the query. Fields that are undefined on
 * the grant act as wildcards (match anything). This means a grant
 * with { appId: 'foo' } matches queries with { appId: 'foo', instanceId: '123' }.
 *
 * @module kernel/security
 */

// =============================================================================
// CapabilitySubject
// =============================================================================

/**
 * Canonical capability subject — identifies who/what holds a capability grant.
 *
 * All fields are optional; the combination of set fields determines specificity.
 * A subject with more fields set is more specific (narrower scope).
 */
export interface CapabilitySubject {
  /** Package ID — the distributable unit (npm package, marketplace listing) */
  readonly packageId?: string;
  /** App ID — a runnable application within a package */
  readonly appId?: string;
  /** Plugin ID — a plugin contribution within an app */
  readonly pluginId?: string;
  /** Instance ID — a specific runtime instance of an app/plugin */
  readonly instanceId?: string;
  /** Workspace ID — scopes the grant to a specific workspace */
  readonly workspaceId?: string;
  /** Tenant ID — scopes the grant to a specific tenant (multi-tenant) */
  readonly tenantId?: string;
  /** Resource binding ID — scopes the grant to a specific resource (document, table) */
  readonly resourceBindingId?: string;
}

/**
 * All subject field names, used for iteration.
 */
const SUBJECT_FIELDS: ReadonlyArray<keyof CapabilitySubject> = [
  'packageId',
  'appId',
  'pluginId',
  'instanceId',
  'workspaceId',
  'tenantId',
  'resourceBindingId',
];

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a CapabilitySubject from partial fields.
 *
 * Strips undefined values so the resulting object only contains
 * explicitly set fields. This matters for matching semantics.
 */
export function createCapabilitySubject(fields: Partial<CapabilitySubject>): CapabilitySubject {
  const subject: Record<string, string> = {};
  for (const key of SUBJECT_FIELDS) {
    const value = fields[key];
    if (value !== undefined) {
      subject[key] = value;
    }
  }
  return Object.freeze(subject) as CapabilitySubject;
}

// =============================================================================
// Matching
// =============================================================================

/**
 * Check whether a grant subject matches a query subject.
 *
 * A grant matches a query when every field that is SET on the grant
 * has the same value on the query. Fields that are undefined on the
 * grant are wildcards and match any query value (including undefined).
 *
 * Examples:
 * - grant { appId: 'foo' } matches query { appId: 'foo', instanceId: '123' } -> true
 * - grant { appId: 'foo', instanceId: '123' } matches query { appId: 'foo', instanceId: '456' } -> false
 * - grant {} matches anything -> true (universal grant)
 *
 * @param grant - The grant-side subject (defines constraints)
 * @param query - The query-side subject (the actual caller identity)
 * @returns true if grant matches query
 */
export function subjectMatches(grant: CapabilitySubject, query: CapabilitySubject): boolean {
  for (const key of SUBJECT_FIELDS) {
    const grantValue = grant[key];
    // If the grant field is set, the query must have the same value
    if (grantValue !== undefined) {
      if (query[key] !== grantValue) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Check whether `narrower` is a strict narrowing of `broader`.
 *
 * A subject B is narrowed by subject N when:
 * 1. Every field set in B is also set in N with the same value
 * 2. N has at least one additional field set that B does not
 *
 * This is used to verify that a derived grant is strictly more specific
 * than its parent grant (no privilege escalation).
 *
 * @param broader - The broader (less specific) subject
 * @param narrower - The narrower (more specific) subject
 * @returns true if narrower is a strict subset of broader
 */
export function isNarrowedBy(broader: CapabilitySubject, narrower: CapabilitySubject): boolean {
  let hasExtraField = false;

  for (const key of SUBJECT_FIELDS) {
    const broaderValue = broader[key];
    const narrowerValue = narrower[key];

    if (broaderValue !== undefined) {
      // Broader has this field — narrower must match exactly
      if (narrowerValue !== broaderValue) {
        return false;
      }
    } else if (narrowerValue !== undefined) {
      // Narrower adds a field that broader doesn't have
      hasExtraField = true;
    }
  }

  return hasExtraField;
}

/**
 * Count the number of fields set on a subject.
 * More fields = more specific subject.
 */
export function subjectSpecificity(subject: CapabilitySubject): number {
  let count = 0;
  for (const key of SUBJECT_FIELDS) {
    if (subject[key] !== undefined) {
      count++;
    }
  }
  return count;
}

/**
 * Check if two subjects are structurally equal (same fields, same values).
 */
export function subjectsEqual(a: CapabilitySubject, b: CapabilitySubject): boolean {
  for (const key of SUBJECT_FIELDS) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

/**
 * Create a string key from a subject for use as a Map key.
 * Fields are sorted and joined deterministically.
 */
export function subjectKey(subject: CapabilitySubject): string {
  const parts: string[] = [];
  for (const key of SUBJECT_FIELDS) {
    const value = subject[key];
    if (value !== undefined) {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.join('|');
}
