import type { VersionDiffEntry } from '@mog-sdk/contracts/api';

export type SemanticDiffOrderKey = string;

export type SemanticDiffPageCursor =
  | { readonly kind: 'offset'; readonly offset: number }
  | { readonly kind: 'orderKey'; readonly orderKey: SemanticDiffOrderKey };

export type MappedSemanticDiffEntry = {
  readonly entry: VersionDiffEntry;
  readonly orderKey: SemanticDiffOrderKey;
  readonly hasExplicitOrderKey: boolean;
};

type SemanticDiffEntrySource = {
  readonly entry: VersionDiffEntry;
  readonly source: unknown;
};

export function mapEntriesWithOrderKeys(
  entries: readonly SemanticDiffEntrySource[],
): readonly MappedSemanticDiffEntry[] {
  const uniqueEntries = withUniqueChangeIds(entries);
  const mapped = uniqueEntries.map(({ entry, source }) => {
    const explicitKey = explicitOrderKey(source, entry);
    return {
      entry,
      orderKey: explicitKey ?? fallbackOrderKey(entry),
      hasExplicitOrderKey: explicitKey !== null,
    };
  });
  return mapped.some((entry) => entry.hasExplicitOrderKey)
    ? [...mapped].sort((a, b) => compareOrderKeys(a.orderKey, b.orderKey))
    : mapped;
}

export function pageStartOffset(
  entries: readonly MappedSemanticDiffEntry[],
  cursor: SemanticDiffPageCursor,
): number {
  if (cursor.kind === 'offset') return cursor.offset;
  const index = entries.findIndex((entry) => compareOrderKeys(entry.orderKey, cursor.orderKey) > 0);
  return index < 0 ? entries.length : index;
}

export function isSemanticDiffOrderKey(value: string): value is SemanticDiffOrderKey {
  let parts: unknown;
  try {
    parts = JSON.parse(value);
  } catch {
    return false;
  }

  if (!Array.isArray(parts) || parts.length !== 6) return false;
  const [domainOrder, hashPropertyPath, canonicalEventKey, hashIdentity, valueClass, changeId] =
    parts;
  return (
    typeof domainOrder === 'string' &&
    /^[0-9]+$/.test(domainOrder) &&
    typeof hashPropertyPath === 'string' &&
    (canonicalEventKey === null || typeof canonicalEventKey === 'string') &&
    (hashIdentity === null || typeof hashIdentity === 'string') &&
    typeof valueClass === 'string' &&
    typeof changeId === 'string'
  );
}

function withUniqueChangeIds(
  entries: readonly SemanticDiffEntrySource[],
): readonly SemanticDiffEntrySource[] {
  const counts = new Map<string, number>();
  for (const { entry } of entries) {
    if (entry.structural.kind === 'metadata') {
      counts.set(entry.structural.changeId, (counts.get(entry.structural.changeId) ?? 0) + 1);
    }
  }
  if (![...counts.values()].some((count) => count > 1)) return entries;
  return entries.map(({ entry, source }) => {
    const structural = entry.structural;
    if (structural.kind !== 'metadata' || counts.get(structural.changeId) === 1) {
      return { entry, source };
    }
    const suffix = encodeURIComponent(
      JSON.stringify([structural.domain, structural.entityId, structural.propertyPath]),
    );
    return {
      source,
      entry: {
        ...entry,
        structural: { ...structural, changeId: `${structural.changeId}~${suffix}` },
      },
    };
  });
}

function explicitOrderKey(source: unknown, entry: VersionDiffEntry): SemanticDiffOrderKey | null {
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
  return orderKeyString(
    domainOrder,
    key.hashPropertyPath,
    typeof key.canonicalEventKey === 'string' ? key.canonicalEventKey : undefined,
    typeof key.hashIdentity === 'string' ? key.hashIdentity : undefined,
    typeof key.valueClass === 'string' ? key.valueClass : 'authored',
    entry.structural.changeId,
  );
}

function fallbackOrderKey(entry: VersionDiffEntry): SemanticDiffOrderKey {
  const structural = entry.structural;
  return structural.kind === 'metadata'
    ? orderKeyString(
        90,
        structural.propertyPath.join('/'),
        undefined,
        structural.entityId,
        'authored',
        structural.changeId,
      )
    : orderKeyString(100, '', undefined, undefined, 'diagnosticOnly', '');
}

function compareOrderKeys(a: SemanticDiffOrderKey, b: SemanticDiffOrderKey): number {
  return a.localeCompare(b);
}

function orderKeyString(
  domainOrder: number,
  hashPropertyPath: string,
  canonicalEventKey: string | undefined,
  hashIdentity: string | undefined,
  valueClass: string,
  changeId: string,
): string {
  return JSON.stringify([
    domainOrder.toString().padStart(5, '0'),
    hashPropertyPath,
    canonicalEventKey ?? null,
    hashIdentity ?? null,
    valueClass,
    changeId,
  ]);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
