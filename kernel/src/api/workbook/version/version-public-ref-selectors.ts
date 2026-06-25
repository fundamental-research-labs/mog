import type {
  RefName,
  RefNameValidationIssue,
} from '../../../document/version-store/refs/ref-name';
import {
  REF_NAME_STORAGE_PREFIX,
  validateRefName,
} from '../../../document/version-store/refs/ref-name';

export type PublicVersionBranchRefIssue = RefNameValidationIssue | 'reservedPublicNamespace';

export type PublicVersionBranchRefValidationResult =
  | { readonly ok: true; readonly name: RefName }
  | {
      readonly ok: false;
      readonly diagnostics: readonly {
        readonly issue: PublicVersionBranchRefIssue;
      }[];
    };

const RESERVED_PUBLIC_REF_NAMESPACES = new Set([
  'deleted',
  'hidden',
  'internal',
  'opaque',
  'private',
  'protected',
  'system',
]);

const PUBLIC_DIAGNOSTIC_REF_NAMESPACES = new Set(['scenario']);

export function validatePublicVersionBranchRefName(
  value: unknown,
  paramName = 'refName',
): PublicVersionBranchRefValidationResult {
  const parsed = validateRefName(value, paramName);
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: parsed.diagnostics.map((diagnostic) => ({ issue: diagnostic.issue })),
    };
  }

  const topLevelNamespace = parsed.name.split('/')[0];
  if (topLevelNamespace && RESERVED_PUBLIC_REF_NAMESPACES.has(topLevelNamespace)) {
    return {
      ok: false,
      diagnostics: [{ issue: 'reservedPublicNamespace' }],
    };
  }

  return { ok: true, name: parsed.name };
}

export function mapPublicVersionDiagnosticRefName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const branchName = value.startsWith(REF_NAME_STORAGE_PREFIX)
    ? value.slice(REF_NAME_STORAGE_PREFIX.length)
    : value;
  const parsed = validatePublicVersionBranchRefName(branchName);
  if (!parsed.ok) return null;
  if (parsed.name === 'main') return `${REF_NAME_STORAGE_PREFIX}main`;

  const topLevelNamespace = parsed.name.split('/')[0];
  if (!topLevelNamespace || !PUBLIC_DIAGNOSTIC_REF_NAMESPACES.has(topLevelNamespace)) {
    return null;
  }
  return `${REF_NAME_STORAGE_PREFIX}${parsed.name}`;
}
