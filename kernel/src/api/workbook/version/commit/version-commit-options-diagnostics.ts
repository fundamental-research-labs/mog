import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import { publicDiagnostic } from './version-commit-diagnostics';
import {
  ANNOTATION_BINDING_FIELDS,
  AUTHOR_SPOOFING_FIELDS,
  DIRECT_SEGMENT_FIELDS,
  OBJECT_BINDING_FIELDS,
  PARENT_OVERRIDE_FIELDS,
  REF_MUTATION_FIELDS,
  ROOT_IMPORT_PROVENANCE_FIELDS,
} from './version-commit-options-constants';

export function diagnosticForRejectedCommitField(field: string): VersionStoreDiagnostic {
  if (REF_MUTATION_FIELDS.has(field)) {
    return publicDiagnostic(
      'VERSION_REF_WRITE_UNAVAILABLE',
      'Public version commits always target the current HEAD; ref mutation fields are not accepted.',
      rejectedCommitFieldOptions(field),
    );
  }
  if (AUTHOR_SPOOFING_FIELDS.has(field)) {
    return publicDiagnostic(
      'VERSION_PERMISSION_DENIED',
      'Public version commits derive author identity from authenticated operation context.',
      rejectedCommitFieldOptions(field),
    );
  }
  if (PARENT_OVERRIDE_FIELDS.has(field)) {
    return publicDiagnostic(
      'VERSION_PERMISSION_DENIED',
      'Public version commits derive parents from the current graph head.',
      rejectedCommitFieldOptions(field),
    );
  }
  if (DIRECT_SEGMENT_FIELDS.has(field) || ROOT_IMPORT_PROVENANCE_FIELDS.has(field)) {
    return publicDiagnostic(
      'VERSION_INVALID_OPTIONS',
      'Public version commits do not accept direct segment or provenance inputs in this slice.',
      rejectedCommitFieldOptions(field),
    );
  }
  if (ANNOTATION_BINDING_FIELDS.has(field)) {
    return publicDiagnostic(
      'VERSION_INVALID_OPTIONS',
      'Public version commits bind annotations through sanitized message text only.',
      rejectedCommitFieldOptions(field),
    );
  }
  if (OBJECT_BINDING_FIELDS.has(field)) {
    return publicDiagnostic(
      'VERSION_INVALID_OPTIONS',
      'Public version commits derive immutable object digests from captured materializable state.',
      rejectedCommitFieldOptions(field),
    );
  }
  return invalidCommitOptionDiagnostic(field, `Unknown commit option "${field}".`);
}

export function invalidCommitOptionDiagnostic(
  option: string,
  safeMessage: string,
): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_INVALID_OPTIONS', safeMessage, {
    severity: 'error',
    recoverability: 'none',
    payload: { option },
    mutationGuarantee: 'no-write-attempted',
  });
}

function rejectedCommitFieldOptions(field: string): Parameters<typeof publicDiagnostic>[2] {
  return {
    severity: 'error',
    recoverability: 'unsupported',
    payload: { option: field },
    mutationGuarantee: 'no-write-attempted',
  };
}
