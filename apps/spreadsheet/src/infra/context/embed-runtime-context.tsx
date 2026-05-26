import React, { createContext, useContext } from 'react';

import type {
  HostSpreadsheetCommandBridge,
  HostSpreadsheetCommandRequest,
  HostSpreadsheetCommandResult,
} from '@mog-sdk/contracts/actions';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

export interface SpreadsheetEmbedSelectionSnapshot {
  readonly activeSheetId: SheetId;
  readonly selectedRanges: readonly string[];
  readonly activeCell: {
    readonly sheetId: SheetId;
    readonly row: number;
    readonly col: number;
    readonly address: string;
  } | null;
}

export interface SpreadsheetEmbedActiveSheetSnapshot {
  readonly sheetId: SheetId;
  readonly sheetName?: string;
}

export interface SpreadsheetEmbedAppBridge {
  readonly documentId: string;
  getSelection(): SpreadsheetEmbedSelectionSnapshot;
  getActiveSheet(): SpreadsheetEmbedActiveSheetSnapshot;
  setActiveSheet(sheetIdOrName: string): Promise<void>;
  select(input: { readonly sheet?: string; readonly range: string }): Promise<void>;
  scrollTo(input: {
    readonly sheet?: string;
    readonly range?: string;
    readonly row?: number;
    readonly col?: number;
  }): Promise<void>;
  startEdit(input: {
    readonly sheet?: string;
    readonly address: string;
    readonly value?: string;
  }): Promise<void>;
  commitEdit(): Promise<void>;
  cancelEdit(): Promise<void>;
  onSelectionChange(handler: (snapshot: SpreadsheetEmbedSelectionSnapshot) => void): () => void;
  onActiveSheetChange(handler: (snapshot: SpreadsheetEmbedActiveSheetSnapshot) => void): () => void;
}

export interface SpreadsheetEmbedRuntimeContextValue {
  readonly documentId?: string;
  readonly hostCommands?: HostSpreadsheetCommandBridge;
  readonly slots?: Readonly<Record<string, React.ReactNode>>;
  registerAppBridge?(bridge: SpreadsheetEmbedAppBridge): () => void;
}

const SpreadsheetEmbedRuntimeContext = createContext<SpreadsheetEmbedRuntimeContextValue | null>(
  null,
);

export function SpreadsheetEmbedRuntimeProvider({
  children,
  value,
}: {
  readonly children: React.ReactNode;
  readonly value: SpreadsheetEmbedRuntimeContextValue;
}): React.JSX.Element {
  return (
    <SpreadsheetEmbedRuntimeContext.Provider value={value}>
      {children}
    </SpreadsheetEmbedRuntimeContext.Provider>
  );
}

export function useSpreadsheetEmbedRuntimeOptional(): SpreadsheetEmbedRuntimeContextValue | null {
  return useContext(SpreadsheetEmbedRuntimeContext);
}

export function useSpreadsheetHostCommandsOptional(): HostSpreadsheetCommandBridge | undefined {
  return useContext(SpreadsheetEmbedRuntimeContext)?.hostCommands;
}

export function useSpreadsheetEmbedSlot(name: string): React.ReactNode {
  return useContext(SpreadsheetEmbedRuntimeContext)?.slots?.[name] ?? null;
}

export type {
  CellCoord as SpreadsheetEmbedCellCoord,
  CellRange as SpreadsheetEmbedCellRange,
  HostSpreadsheetCommandBridge,
  HostSpreadsheetCommandRequest,
  HostSpreadsheetCommandResult,
};
