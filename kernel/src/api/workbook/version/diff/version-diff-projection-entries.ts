import type { VersionDiffEntry, VersionStoreDiagnostic } from '@mog-sdk/contracts/api';
import { projectReviewAccessDiffValue } from '../../../../document/version-store/review-access-projection';
import { RAW_PUBLIC_DIFF_DOMAINS } from './version-diff-constants';
import {
  mapGraphDiagnostics,
  publicDiagnostic,
  unsupportedDiffDomainDiagnostic,
} from './version-diff-diagnostics';
import { isRecord } from './version-diff-utils';
import {
  orderDiffEntries,
  semanticDiffOrderKey,
  type ProjectedDiffEntry,
} from './version-diff-projection-ordering';
import { redactCellEntry } from './version-diff-projection-redaction';
import {
  mapDiffDisplay,
  mapReviewAccessDiffValue,
  mapStructuralMetadata,
} from './version-diff-projection-values';

export function mapDiffEntries(values: readonly unknown[]): {
  readonly items: readonly VersionDiffEntry[];
  readonly diagnostics: readonly VersionStoreDiagnostic[];
} {
  const items: ProjectedDiffEntry[] = [];
  const diagnostics: VersionStoreDiagnostic[] = [];
  values.forEach((value, index) => {
    const entry = mapDiffEntry(value);
    if (entry) {
      items.push({
        entry,
        explicitOrderKey: explicitDiffOrderKey(value, entry),
        sourceIndex: index,
      });
      return;
    }
    const unsupportedDomain = unsupportedDiffDomain(value);
    diagnostics.push(
      unsupportedDomain
        ? unsupportedDiffDomainDiagnostic(unsupportedDomain, index)
        : publicDiagnostic(
            'VERSION_INVALID_COMMIT_PAYLOAD',
            'A version diff entry could not be safely projected.',
            {
              severity: 'error',
              recoverability: 'repair',
              payload: { itemIndex: index },
            },
          ),
    );
  });
  return { items: orderDiffEntries(items), diagnostics };
}

function mapDiffEntry(value: unknown): VersionDiffEntry | null {
  if (!isRecord(value)) return null;
  const structural = mapStructuralMetadata(value.structural ?? value);
  const before = structural ? mapReviewAccessDiffValue(structural, value.before) : null;
  const after = structural ? mapReviewAccessDiffValue(structural, value.after) : null;
  if (!structural || !before || !after) return null;
  const display = value.display === undefined ? undefined : mapDiffDisplay(value.display);
  if (value.display !== undefined && !display) return null;
  const diagnostics = Array.isArray(value.diagnostics)
    ? mapGraphDiagnostics(value.diagnostics)
    : undefined;
  return redactCellEntry({
    structural,
    before,
    after,
    ...(display ? { display } : {}),
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
  });
}

function explicitDiffOrderKey(source: unknown, entry: VersionDiffEntry): string | null {
  const key =
    isRecord(source) && isRecord(source.pageCursorOrderKey) ? source.pageCursorOrderKey : null;
  const domainOrder = key ? Number(key.domainOrder) : NaN;
  if (
    entry.structural.kind !== 'metadata' ||
    !Number.isSafeInteger(domainOrder) ||
    typeof key?.hashPropertyPath !== 'string'
  ) {
    return null;
  }
  return semanticDiffOrderKey(
    domainOrder,
    key.hashPropertyPath,
    typeof key.canonicalEventKey === 'string' ? key.canonicalEventKey : undefined,
    typeof key.hashIdentity === 'string' ? key.hashIdentity : undefined,
    typeof key.valueClass === 'string' ? key.valueClass : 'authored',
    entry.structural.changeId,
  );
}

function unsupportedDiffDomain(value: unknown): string | null {
  const structural = mapStructuralMetadata(isRecord(value) ? (value.structural ?? value) : value);
  if (structural?.kind !== 'metadata' || RAW_PUBLIC_DIFF_DOMAINS.has(structural.domain)) {
    return null;
  }
  const redacted = { kind: 'redacted', reason: 'permission-denied' };
  return projectReviewAccessDiffValue(structural, redacted) === undefined
    ? structural.domain
    : null;
}
