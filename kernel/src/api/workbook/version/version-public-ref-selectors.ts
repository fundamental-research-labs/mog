import type {
  RefName,
  RefNameValidationIssue,
} from '../../../document/version-store/refs/ref-name';
import { validateRefName } from '../../../document/version-store/refs/ref-name';

export type PublicVersionBranchRefIssue =
  | RefNameValidationIssue
  | 'reservedPublicNamespace';

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
