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
type MetadataDiffStructural = Extract<VersionDiffStructuralMetadata, { readonly kind: 'metadata' }>;

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
  const structuralCounts = new Map<string, number>();
  const valueCounts = new Map<string, number>();
  for (const item of items) {
    const structural = metadataForOrder(item.source, item.entry);
    if (structural) {
      counts.set(structural.changeId, (counts.get(structural.changeId) ?? 0) + 1);
    }
  }
  if (![...counts.values()].some((count) => count > 1)) return items;
  for (const item of items) {
    const structural = metadataForOrder(item.source, item.entry);
    if (!structural || counts.get(structural.changeId) === 1) continue;
    const structuralKey = duplicateStructuralKey(structural);
    const structuralScope = `${structural.changeId}\u0000${structuralKey}`;
    const valueScope = `${structuralScope}\u0000${duplicateValueHash(item.entry)}`;
    structuralCounts.set(structuralScope, (structuralCounts.get(structuralScope) ?? 0) + 1);
    valueCounts.set(valueScope, (valueCounts.get(valueScope) ?? 0) + 1);
  }
  const valueOccurrences = new Map<string, number>();
  return items.map((item) => {
    const structural = metadataForOrder(item.source, item.entry);
    if (!structural || counts.get(structural.changeId) === 1) {
      return item;
    }
    const structuralKey = duplicateStructuralKey(structural);
    const structuralScope = `${structural.changeId}\u0000${structuralKey}`;
    const valueHash = duplicateValueHash(item.entry);
    const valueScope = `${structuralScope}\u0000${valueHash}`;
    const occurrence =
      (valueCounts.get(valueScope) ?? 0) > 1
        ? nextDuplicateOccurrence(valueOccurrences, valueScope)
        : undefined;
    const suffix = encodeURIComponent(
      structuralCounts.get(structuralScope) === 1
        ? structuralKey
        : duplicateStructuralValueKey(structural, valueHash, occurrence),
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

function duplicateStructuralKey(structural: MetadataDiffStructural): string {
  return JSON.stringify([structural.domain, structural.entityId, structural.propertyPath]);
}

function duplicateStructuralValueKey(
  structural: MetadataDiffStructural,
  valueHash: string,
  occurrence: string | undefined,
): string {
  return JSON.stringify([
    structural.domain,
    structural.entityId,
    structural.propertyPath,
    valueHash,
    ...(occurrence === undefined ? [] : [occurrence]),
  ]);
}

function duplicateValueHash(entry: VersionDiffEntry): string {
  return stringFingerprint(stableStringify([entry.before, entry.after, entry.display ?? null]));
}

function nextDuplicateOccurrence(occurrences: Map<string, number>, key: string): string {
  const occurrence = occurrences.get(key) ?? 0;
  occurrences.set(key, occurrence + 1);
  return occurrence.toString().padStart(12, '0');
}

function stringFingerprint(value: string): string {
  let primary = 0x811c9dc5;
  let secondary = 0x811c9dc5 ^ value.length;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    primary = Math.imul(primary ^ code, 0x01000193);
    secondary = Math.imul(secondary ^ code, 0x5bd1e995);
  }
  return [
    (primary >>> 0).toString(36),
    (secondary >>> 0).toString(36),
    value.length.toString(36),
  ].join('.');
}

function stableStringify(value: unknown): string {
  if (value === undefined) return '"__undefined__"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Readonly<Record<string, unknown>>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
}

function metadataForOrder(source: unknown, entry: VersionDiffEntry): MetadataDiffStructural | null {
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
