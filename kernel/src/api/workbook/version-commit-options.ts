import type {
  RedactionPolicy,
  VersionCommitOptions,
  VersionMainRefName,
  VersionRefName,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { validateRefName } from '../../document/version-store/ref-name';
import {
  publicDiagnostic,
  VERSION_BRANCH_REF_PREFIX,
  VERSION_HEAD_REF,
  VERSION_MAIN_REF,
} from './version-commit-diagnostics';
import type { CommitValidationResult, NormalizedCommitOptions } from './version-commit-types';
import { isRecord, toCommitId, toPublicRevision } from './version-commit-utils';

const VERSION_COMMIT_OPTION_KEYS = new Set([
  'message',
  'targetRef',
  'redactionPolicy',
  'expectedHead',
  'mode',
]);
const VERSION_COMMIT_EXPECTED_HEAD_KEYS = new Set([
  'commitId',
  'revision',
  'symbolicHeadRevision',
]);
const VERSION_COMMIT_MODE_KEYS = new Set(['kind']);
const REDACTION_POLICY_KEYS = new Set([
  'mode',
  'redactSecrets',
  'redactExternalLinks',
  'redactAgentTrace',
]);
const REDACTION_POLICY_MODES = new Set(['default', 'strict', 'clean']);
const REF_MUTATION_FIELDS = new Set(['ref', 'branch']);
const AUTHOR_SPOOFING_FIELDS = new Set([
  'author',
  'committer',
  'principal',
  'principalScope',
  'updatedBy',
]);
const PARENT_OVERRIDE_FIELDS = new Set([
  'parents',
  'parentCommitIds',
  'parentIds',
  'baseCommitId',
]);
const DIRECT_SEGMENT_FIELDS = new Set([
  'segmentIds',
  'segments',
  'mutationSegments',
  'changeSet',
  'semanticChangeSet',
  'semanticChanges',
  'operations',
  'captureFrontier',
  'frontier',
]);
const ROOT_IMPORT_PROVENANCE_FIELDS = new Set([
  'expectedRegistryRevision',
  'root',
  'rootEvidence',
  'importRootEvidence',
  'provenance',
  'trustRoots',
]);
const ANNOTATION_BINDING_FIELDS = new Set([
  'annotation',
  'annotationDigest',
  'annotationRecord',
  'annotationRevision',
  'tags',
  'title',
]);
const OBJECT_BINDING_FIELDS = new Set([
  'authorizationSnapshot',
  'authorizationSnapshotDigest',
  'commitId',
  'commitRecord',
  'objectRecords',
  'redactionPolicyDigest',
  'redactionSummary',
  'redactionSummaryDigest',
  'semanticChangeSetDigest',
  'snapshotRoot',
  'snapshotRootDigest',
  'snapshotRootRecord',
  'verificationSummary',
  'verificationSummaryDigest',
]);

export function validateCommitOptions(input: VersionCommitOptions): CommitValidationResult {
  if (input === undefined) return { ok: true, options: {} };
  if (!isRecord(input) || Array.isArray(input)) {
    return {
      ok: false,
      diagnostics: [
        invalidCommitOptionDiagnostic('options', 'commit options must be an object when supplied.'),
      ],
    };
  }

  const diagnostics: VersionStoreDiagnostic[] = [];
  const options: NormalizedCommitOptions = {};

  for (const key of Object.keys(input)) {
    if (VERSION_COMMIT_OPTION_KEYS.has(key)) continue;
    diagnostics.push(diagnosticForRejectedCommitField(key));
  }

  if ('message' in input) {
    const message = validateCommitMessage(input.message, diagnostics);
    if (message !== undefined) options.message = message;
  }

  if ('redactionPolicy' in input) {
    const redactionPolicy = validateRedactionPolicy(input.redactionPolicy, diagnostics);
    if (redactionPolicy) options.redactionPolicy = redactionPolicy;
  }

  const hasExplicitTargetRef = 'targetRef' in input;
  if (hasExplicitTargetRef) {
    const targetRef = validateTargetRef(input.targetRef, diagnostics);
    if (targetRef) options.targetRef = targetRef;
  }

  let modeKind: unknown;
  if ('mode' in input) {
    const mode = input.mode;
    if (!isRecord(mode) || Array.isArray(mode)) {
      diagnostics.push(invalidCommitOptionDiagnostic('mode', 'commit mode must be an object.'));
    } else {
      rejectUnknownNestedKeys(mode, VERSION_COMMIT_MODE_KEYS, 'mode', diagnostics);
      modeKind = mode.kind;
      if (modeKind === 'normal') {
        options.mode = { kind: 'normal' };
      } else if (modeKind === 'root' || modeKind === 'import-root') {
        diagnostics.push(
          invalidCommitOptionDiagnostic(
            'mode',
            'root and import-root commit modes are not exposed by this public commit slice.',
          ),
        );
      } else {
        diagnostics.push(invalidCommitOptionDiagnostic('mode.kind', 'commit mode is unsupported.'));
      }
    }
  }

  if ('expectedHead' in input) {
    const expectedHead = validateExpectedHead(input.expectedHead, diagnostics);
    if (expectedHead) options.expectedHead = expectedHead;
    if (hasExplicitTargetRef && expectedHead?.symbolicHeadRevision !== undefined) {
      diagnostics.push(
        invalidCommitOptionDiagnostic(
          'expectedHead.symbolicHeadRevision',
          'symbolicHeadRevision is valid only for implicit HEAD commits.',
        ),
      );
    }
    if (modeKind === 'root' || modeKind === 'import-root') {
      diagnostics.push(
        invalidCommitOptionDiagnostic(
          'expectedHead',
          'expectedHead is valid only for normal version commits.',
        ),
      );
    }
  }

  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, options };
}

function validateTargetRef(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): VersionMainRefName | VersionRefName | undefined {
  if (typeof value !== 'string') {
    diagnostics.push(invalidCommitOptionDiagnostic('targetRef', 'targetRef must be a string.'));
    return undefined;
  }
  if (value === VERSION_HEAD_REF) {
    diagnostics.push(
      invalidCommitOptionDiagnostic('targetRef', 'targetRef must be a concrete refs/heads/* ref.'),
    );
    return undefined;
  }

  const branchName = value.startsWith(VERSION_BRANCH_REF_PREFIX)
    ? value.slice(VERSION_BRANCH_REF_PREFIX.length)
    : value;
  const parsed = validateRefName(branchName, 'targetRef');
  if (!parsed.ok) {
    diagnostics.push(
      ...parsed.diagnostics.map((item) =>
        publicDiagnostic(
          'VERSION_INVALID_OPTIONS',
          'targetRef must name a public-safe version branch.',
          {
            severity: 'error',
            recoverability: 'none',
            payload: { option: 'targetRef', issue: item.issue, refName: 'redacted' },
            mutationGuarantee: 'no-write-attempted',
          },
        ),
      ),
    );
    return undefined;
  }

  return parsed.name === 'main'
    ? VERSION_MAIN_REF
    : (`${VERSION_BRANCH_REF_PREFIX}${parsed.name}` as VersionRefName);
}

function validateExpectedHead(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): VersionCommitOptions['expectedHead'] | undefined {
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(
      invalidCommitOptionDiagnostic('expectedHead', 'expectedHead must be an object.'),
    );
    return undefined;
  }

  rejectUnknownNestedKeys(value, VERSION_COMMIT_EXPECTED_HEAD_KEYS, 'expectedHead', diagnostics);
  const commitId = toCommitId(value.commitId);
  const revision = toPublicRevision(value.revision);
  const symbolicHeadRevision =
    value.symbolicHeadRevision === undefined
      ? undefined
      : toPublicRevision(value.symbolicHeadRevision);

  if (!commitId) {
    diagnostics.push(
      invalidCommitOptionDiagnostic('expectedHead.commitId', 'expectedHead.commitId is invalid.'),
    );
  }
  if (!revision) {
    diagnostics.push(
      invalidCommitOptionDiagnostic('expectedHead.revision', 'expectedHead.revision is invalid.'),
    );
  }
  if ('symbolicHeadRevision' in value && !symbolicHeadRevision) {
    diagnostics.push(
      invalidCommitOptionDiagnostic(
        'expectedHead.symbolicHeadRevision',
        'expectedHead.symbolicHeadRevision is invalid.',
      ),
    );
  }
  if (!commitId || !revision || ('symbolicHeadRevision' in value && !symbolicHeadRevision)) {
    return undefined;
  }

  return {
    commitId,
    revision,
    ...(symbolicHeadRevision ? { symbolicHeadRevision } : {}),
  };
}

function validateRedactionPolicy(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): RedactionPolicy | undefined {
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(
      invalidCommitOptionDiagnostic('redactionPolicy', 'redactionPolicy must be an object.'),
    );
    return undefined;
  }

  rejectUnknownNestedKeys(value, REDACTION_POLICY_KEYS, 'redactionPolicy', diagnostics);
  if (!REDACTION_POLICY_MODES.has(String(value.mode))) {
    diagnostics.push(
      invalidCommitOptionDiagnostic(
        'redactionPolicy.mode',
        'redactionPolicy.mode is unsupported.',
      ),
    );
  }

  for (const key of ['redactSecrets', 'redactExternalLinks', 'redactAgentTrace'] as const) {
    if (typeof value[key] !== 'boolean') {
      diagnostics.push(
        invalidCommitOptionDiagnostic(`redactionPolicy.${key}`, `${key} must be a boolean.`),
      );
    }
  }

  if (
    !REDACTION_POLICY_MODES.has(String(value.mode)) ||
    typeof value.redactSecrets !== 'boolean' ||
    typeof value.redactExternalLinks !== 'boolean' ||
    typeof value.redactAgentTrace !== 'boolean'
  ) {
    return undefined;
  }

  return {
    mode: value.mode as RedactionPolicy['mode'],
    redactSecrets: value.redactSecrets,
    redactExternalLinks: value.redactExternalLinks,
    redactAgentTrace: value.redactAgentTrace,
  };
}

function rejectUnknownNestedKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: ReadonlySet<string>,
  option: string,
  diagnostics: VersionStoreDiagnostic[],
): void {
  for (const key of Object.keys(value)) {
    if (allowedKeys.has(key)) continue;
    diagnostics.push(
      invalidCommitOptionDiagnostic(`${option}.${key}`, `Unknown ${option} option "${key}".`),
    );
  }
}

function diagnosticForRejectedCommitField(field: string): VersionStoreDiagnostic {
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

function rejectedCommitFieldOptions(field: string): Parameters<typeof publicDiagnostic>[2] {
  return {
    severity: 'error',
    recoverability: 'unsupported',
    payload: { option: field },
    mutationGuarantee: 'no-write-attempted',
  };
}

function invalidCommitOptionDiagnostic(
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

function validateCommitMessage(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): string | undefined {
  if (typeof value !== 'string') {
    diagnostics.push(invalidCommitOptionDiagnostic('message', 'commit message must be a string.'));
    return undefined;
  }
  const message = value.normalize('NFC').replace(/[ \t\n]+$/u, '');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(message)) {
    diagnostics.push(
      invalidCommitOptionDiagnostic(
        'message',
        'commit message contains unsupported control characters.',
      ),
    );
    return undefined;
  }
  if ([...message].length > 4096) {
    diagnostics.push(invalidCommitOptionDiagnostic('message', 'commit message is too long.'));
    return undefined;
  }
  return message;
}
