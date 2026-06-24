import type {
  CellFormat,
  VersionDiffStructuralMetadata,
  VersionMergeChange,
} from '@mog-sdk/contracts/api';
import type { CellValuePrimitive } from '@mog-sdk/contracts/core';

export type MaterializableMergeStructural = Extract<
  VersionDiffStructuralMetadata,
  { readonly kind: 'metadata' }
>;

export type ParsedCellMergeChange = {
  readonly kind: 'cellValue';
  readonly itemIndex: number;
  readonly change: VersionMergeChange;
  readonly structural: MaterializableMergeStructural;
  readonly write: boolean;
  readonly sheetId: string;
  readonly address: string;
  readonly row: number;
  readonly col: number;
  readonly merged: CellMergeValue;
};

export type ParsedDirectFormatMergeChange = {
  readonly kind: 'directCellFormat';
  readonly itemIndex: number;
  readonly change: VersionMergeChange;
  readonly structural: MaterializableMergeStructural;
  readonly write: boolean;
  readonly sheetId: string;
  readonly address: string;
  readonly row: number;
  readonly col: number;
  readonly merged: DirectFormatMergeValue;
};

export type ParsedRowColumnMergeChange = {
  readonly kind: 'rowColumnOrder';
  readonly itemIndex: number;
  readonly change: VersionMergeChange;
  readonly structural: MaterializableMergeStructural;
  readonly sheetId: string;
  readonly axis: RowColumnAxis;
  readonly index: number;
  readonly transition: RowColumnTransition;
};

export type ParsedSheetMetadataMergeChange = {
  readonly kind: 'sheetMetadata';
  readonly itemIndex: number;
  readonly change: VersionMergeChange;
  readonly structural: MaterializableMergeStructural;
  readonly write: boolean;
  readonly sheetId: string;
  readonly property: SheetMetadataProperty;
  readonly merged: SheetMetadataMergeValue;
};

export type ParsedMergeChange =
  | ParsedCellMergeChange
  | ParsedDirectFormatMergeChange
  | ParsedRowColumnMergeChange
  | ParsedSheetMetadataMergeChange;

export type CellMergeValue =
  | {
      readonly kind: 'clear';
    }
  | {
      readonly kind: 'formula';
      readonly formula: string;
    }
  | {
      readonly kind: 'scalar';
      readonly value: CellValuePrimitive;
    };

export type DirectFormatMergeValue =
  | {
      readonly kind: 'clear';
    }
  | {
      readonly kind: 'format';
      readonly format: CellFormat;
    };

export type RowColumnAxis = 'row' | 'column';

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

export type RowColumnTransition =
  | {
      readonly kind: 'noop';
    }
  | {
      readonly kind: 'insert';
      readonly sheetId: string;
      readonly axis: RowColumnAxis;
      readonly index: number;
    }
  | {
      readonly kind: 'delete';
      readonly sheetId: string;
      readonly axis: RowColumnAxis;
      readonly index: number;
    };

export type SheetMetadataProperty = 'name' | 'tabColor' | 'frozen';

export type SheetMetadataMergeValue =
  | {
      readonly property: 'name';
      readonly value: string;
    }
  | {
      readonly property: 'tabColor';
      readonly value: string | null;
    }
  | {
      readonly property: 'frozen';
      readonly rows: number;
      readonly cols: number;
    };
