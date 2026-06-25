import type { VersionCommitOptions, VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import {
  VERSION_COMMIT_MODE_KEYS,
  VERSION_COMMIT_OPTION_KEYS,
} from './version-commit-options-constants';
import {
  diagnosticForRejectedCommitField,
  invalidCommitOptionDiagnostic,
} from './version-commit-options-diagnostics';
import {
  rejectUnknownNestedKeys,
  validateCommitMessage,
  validateExpectedHead,
  validateRedactionPolicy,
  validateTargetRef,
} from './version-commit-options-validators';
import type { CommitValidationResult, NormalizedCommitOptions } from './version-commit-types';
import { isRecord } from './version-commit-utils';

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
