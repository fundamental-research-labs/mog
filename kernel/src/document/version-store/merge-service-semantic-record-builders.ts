import type { VersionDiffStructuralMetadata, VersionRedactedValue } from '@mog-sdk/contracts/api';

import type {
  MergeBranch,
  MergeDiagnostic,
  ParsedSemanticChange,
  ParsedSemanticChangeSet,
  SemanticValueChange,
} from './merge-service-semantic-record-types';
import {
  allowsEmptySemanticPropertyPath,
  hasOpaqueSemanticValue,
  hasRedactedDisplay,
  hasRedactedValue,
  inspectSupportedSemanticValueChange,
  isOpaqueSemanticDiffRecord,
  isRecord,
  mapDiffDisplay,
  mapDiffValue,
  mapStructuralMetadata,
  semanticMergePropertyKey,
} from './merge-service-semantic-record-validation';

export function parseSemanticChangeSet(
  payload: unknown,
  branch: MergeBranch,
): ParsedSemanticChangeSet {
  if (!isRecord(payload) || payload.schemaVersion !== 1) {
    return unsupportedChangeSet(branch);
  }

  const values = Array.isArray(payload.reviewChanges)
    ? payload.reviewChanges
    : Array.isArray(payload.changes)
      ? payload.changes
      : null;
  if (!values) return unsupportedChangeSet(branch);

  const changes: SemanticValueChange[] = [];
  const seenKeys = new Set<string>();
  for (let index = 0; index < values.length; index++) {
    const parsed = parseSemanticChange(values[index], branch, index);
    if (!parsed.ok) return parsed;
    if (seenKeys.has(parsed.change.key)) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_UNSUPPORTED_SCHEMA',
            'Merge preview cannot classify duplicate value changes for the same property.',
            { payload: { branch, itemIndex: index } },
          ),
        ],
      };
    }
    seenKeys.add(parsed.change.key);
    changes.push(parsed.change);
  }

  return { ok: true, changes };
}

function parseSemanticChange(
  value: unknown,
  branch: MergeBranch,
  itemIndex: number,
): ParsedSemanticChange {
  if (!isRecord(value)) return unsupportedChange(branch, itemIndex);
  if (isOpaqueSemanticDiffRecord(value)) {
    return opaqueSemanticChange(branch, itemIndex, {
      reason: 'opaqueSemanticDiffRecord',
      domain: value.domainId,
      objectKind: typeof value.objectKind === 'string' ? value.objectKind : undefined,
    });
  }
  if (
    hasRedactedValue(value.structural) ||
    hasRedactedValue(value.before) ||
    hasRedactedValue(value.after)
  ) {
    return redactedChange(branch, itemIndex);
  }

  const structural = mapStructuralMetadata(value);
  if (!structural) return unsupportedChange(branch, itemIndex);
  if (!allowsEmptySemanticPropertyPath(structural.domain) && structural.propertyPath.length === 0) {
    return unsupportedChange(branch, itemIndex);
  }

  const before = mapDiffValue(value.before);
  const after = mapDiffValue(value.after);
  if (!before || !after) {
    return hasOpaqueSemanticValue(value.before) || hasOpaqueSemanticValue(value.after)
      ? opaqueSemanticChange(branch, itemIndex, {
          reason: 'opaqueSemanticValue',
          domain: structural.domain,
        })
      : unsupportedChange(branch, itemIndex);
  }

  const support = inspectSupportedSemanticValueChange(structural, before, after);
  if (!support.ok) return unsupportedDomainChange(branch, itemIndex, structural, support.reason);

  const display = value.display === undefined ? undefined : mapDiffDisplay(value.display);
  if (value.display !== undefined && !display) {
    return hasRedactedDisplay(value.display)
      ? redactedChange(branch, itemIndex)
      : unsupportedChange(branch, itemIndex);
  }

  return {
    ok: true,
    change: {
      key: semanticMergePropertyKey(structural),
      structural,
      before,
      after,
      ...(display ? { display } : {}),
    },
  };
}

function unsupportedChangeSet(branch: MergeBranch): ParsedSemanticChangeSet {
  return {
    ok: false,
    diagnostics: [
      diagnostic(
        'VERSION_UNSUPPORTED_SCHEMA',
        'Semantic change-set payload is not supported by merge preview.',
        { payload: { branch } },
      ),
    ],
  };
}

function unsupportedChange(branch: MergeBranch, itemIndex: number): ParsedSemanticChange {
  return {
    ok: false,
    diagnostics: [
      diagnostic(
        'VERSION_UNSUPPORTED_SCHEMA',
        'Semantic change record is not supported by merge preview.',
        { payload: { branch, itemIndex } },
      ),
    ],
  };
}

function unsupportedDomainChange(
  branch: MergeBranch,
  itemIndex: number,
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
  reason: string,
): ParsedSemanticChange {
  return {
    ok: false,
    diagnostics: [
      diagnostic(
        'VERSION_MERGE_UNSUPPORTED_DOMAIN',
        'Merge preview supports only allowlisted semantic value changes.',
        {
          payload: {
            branch,
            itemIndex,
            domain: structural.domain,
            propertyPath: structural.propertyPath.join('.'),
            reason,
          },
        },
      ),
    ],
  };
}

function opaqueSemanticChange(
  branch: MergeBranch,
  itemIndex: number,
  details: {
    readonly reason: string;
    readonly domain?: string;
    readonly objectKind?: string;
  },
): ParsedSemanticChange {
  return {
    ok: false,
    diagnostics: [
      diagnostic(
        'VERSION_MERGE_UNSUPPORTED_DOMAIN',
        'Merge preview cannot classify opaque semantic change records.',
        {
          payload: {
            branch,
            itemIndex,
            reason: details.reason,
            ...(details.domain ? { domain: details.domain } : {}),
            ...(details.objectKind ? { objectKind: details.objectKind } : {}),
          },
        },
      ),
    ],
  };
}

function redactedChange(branch: MergeBranch, itemIndex: number): ParsedSemanticChange {
  return {
    ok: false,
    diagnostics: [
      diagnostic(
        'VERSION_REDACTION_VIOLATION',
        'Merge preview cannot classify redacted semantic change records.',
        { recoverability: 'unsupported', payload: { branch, itemIndex } },
      ),
    ],
  };
}

function diagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: MergeDiagnostic['severity'];
    readonly recoverability?: MergeDiagnostic['recoverability'];
    readonly payload?: Readonly<Record<string, string | number | boolean | null>>;
  } = {},
): MergeDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? recoverabilityForIssue(issueCode),
    messageTemplateId: `version.merge.${issueCode}` as MergeDiagnostic['messageTemplateId'],
    safeMessage,
    ...(options.payload ? { payload: { operation: 'merge', ...options.payload } } : {}),
    redacted: true,
  };
}

function recoverabilityForIssue(issueCode: string): MergeDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_MERGE_UNSUPPORTED_DOMAIN':
    case 'VERSION_REDACTION_VIOLATION':
    case 'VERSION_UNSUPPORTED_SCHEMA':
      return 'unsupported';
    default:
      return 'none';
  }
}
