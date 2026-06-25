import type { VersionDiffEntry } from '@mog-sdk/contracts/api';

export type ProjectedDiffEntry = {
  readonly entry: VersionDiffEntry;
  readonly explicitOrderKey: string | null;
  readonly sourceIndex: number;
};

export function orderDiffEntries(
  items: readonly ProjectedDiffEntry[],
): readonly VersionDiffEntry[] {
  if (!items.some((item) => item.explicitOrderKey)) return items.map((item) => item.entry);
  return [...items]
    .sort((a, b) => diffOrderKey(a).localeCompare(diffOrderKey(b)))
    .map((item) => item.entry);
}

function diffOrderKey(item: ProjectedDiffEntry): string {
  return item.explicitOrderKey ?? fallbackDiffOrderKey(item.entry, item.sourceIndex);
}

function fallbackDiffOrderKey(entry: VersionDiffEntry, sourceIndex: number): string {
  const structural = entry.structural;
  return structural.kind === 'metadata'
    ? semanticDiffOrderKey(
        90,
        structural.propertyPath.join('/'),
        undefined,
        structural.entityId,
        'authored',
        structural.changeId,
      )
    : semanticDiffOrderKey(
        100,
        '',
        undefined,
        undefined,
        'diagnosticOnly',
        sourceIndex.toString().padStart(12, '0'),
      );
}

export function semanticDiffOrderKey(
  domainOrder: number,
  path: string,
  eventKey: string | undefined,
  identity: string | undefined,
  valueClass: string,
  changeId: string,
): string {
  return JSON.stringify([
    domainOrder.toString().padStart(5, '0'),
    path,
    eventKey ?? null,
    identity ?? null,
    valueClass,
    changeId,
  ]);
}
