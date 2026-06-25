import type { VersionDiffStructuralMetadata, VersionMergeChange } from '@mog-sdk/contracts/api';

export type MergeMaterializationOperation = 'merge' | 'applyMerge' | 'commitGraphWrite';

export type MergeDomainReference = {
  readonly matrixRowId?: string;
  readonly domainId: string;
};

export type MergeMaterializationSupport =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly structuralKind: VersionDiffStructuralMetadata['kind'];
      readonly domain: string;
      readonly propertyPath: string;
      readonly noop?: boolean;
    };

export type MaterializableMergeStructural = Extract<
  VersionDiffStructuralMetadata,
  { readonly kind: 'metadata' }
>;

export type MergeChangeValueInput = Pick<VersionMergeChange, 'base' | 'merged'> &
  Partial<Pick<VersionMergeChange, 'ours'>>;

export type RowColumnAxis = 'row' | 'column';

export type RowColumnTarget = {
  readonly sheetId: string;
  readonly axis: RowColumnAxis;
  readonly index: number;
};

export type RowColumnMergeValue =
  | {
      readonly kind: 'absent';
    }
  | {
      readonly kind: 'present';
      readonly sheetId: string;
      readonly axis: RowColumnAxis;
      readonly index: number;
    };
