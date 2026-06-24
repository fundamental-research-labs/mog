import type {
  VersionDiffEntry,
  VersionDiffStructuralMetadata,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';
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
import { redactDiffEntry } from './version-diff-projection-redaction';
import {
  mapDiffDisplay,
  mapReviewAccessDiffValue,
  mapStructuralMetadata,
} from './version-diff-projection-values';

type MappedDiffEntry = {
  readonly entry: VersionDiffEntry;
  readonly source: unknown;
  readonly sourceIndex: number;
  readonly orderChangeId?: string;
};
type MetadataDiffStructural = Extract<
  VersionDiffStructuralMetadata,
  { readonly kind: 'metadata' }
>;

export function mapDiffEntries(values: readonly unknown[]): {
  readonly items: readonly VersionDiffEntry[];
  readonly diagnostics: readonly VersionStoreDiagnostic[];
} {
  const mappedItems: MappedDiffEntry[] = [];
  const diagnostics: VersionStoreDiagnostic[] = [];
  values.forEach((value, index) => {
    const entry = mapDiffEntry(value);
    if (entry) {
      mappedItems.push({
        entry,
        source: value,
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
  const items: ProjectedDiffEntry[] = withUniqueMetadataChangeIds(mappedItems).map(
    ({ entry, source, sourceIndex, orderChangeId }) => ({
      entry,
      explicitOrderKey: explicitDiffOrderKey(source, entry, orderChangeId),
      sourceIndex,
    }),
  );
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
  return redactDiffEntry({
    structural,
    before,
    after,
    ...(display ? { display } : {}),
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
  });
}

function explicitDiffOrderKey(
  source: unknown,
  entry: VersionDiffEntry,
  orderChangeId?: string,
): string | null {
  const key =
    isRecord(source) && isRecord(source.pageCursorOrderKey) ? source.pageCursorOrderKey : null;
  const structural = metadataForOrder(source, entry);
  const domainOrder = key ? Number(key.domainOrder) : NaN;
  if (
    !structural ||
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
    orderChangeId ?? structural.changeId,
  );
}

function withUniqueMetadataChangeIds(
  items: readonly MappedDiffEntry[],
): readonly MappedDiffEntry[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const structural = metadataForOrder(item.source, item.entry);
    if (structural) {
      counts.set(structural.changeId, (counts.get(structural.changeId) ?? 0) + 1);
    }
  }
  if (![...counts.values()].some((count) => count > 1)) return items;
  return items.map((item) => {
    const structural = metadataForOrder(item.source, item.entry);
    if (!structural || counts.get(structural.changeId) === 1) {
      return item;
    }
    const suffix = encodeURIComponent(
      JSON.stringify([structural.domain, structural.entityId, structural.propertyPath]),
    );
    const orderChangeId = `${structural.changeId}~${suffix}`;
    return {
      ...item,
      orderChangeId,
      entry:
        item.entry.structural.kind === 'metadata'
          ? {
              ...item.entry,
              structural: { ...item.entry.structural, changeId: orderChangeId },
            }
          : item.entry,
    };
  });
}

function metadataForOrder(
  source: unknown,
  entry: VersionDiffEntry,
): MetadataDiffStructural | null {
  if (entry.structural.kind === 'metadata') return entry.structural;
  const structural = mapStructuralMetadata(
    isRecord(source) ? (source.structural ?? source) : source,
  );
  return structural?.kind === 'metadata' ? structural : null;
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
