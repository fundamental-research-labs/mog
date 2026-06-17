import {
  Utils as KernelUtils,
  MogDocumentFactory as KernelMogDocumentFactory,
  MogSdkError as KernelMogSdkError,
  MogSdkEventFacade as KernelMogSdkEventFacade,
  address as kernelAddress,
  column as kernelColumn,
  columnIndex as kernelColumnIndex,
  columnName as kernelColumnName,
  colToLetter as kernelColToLetter,
  offset as kernelOffset,
  parse as kernelParse,
  parseAddress as kernelParseAddress,
  parseCellAddress as kernelParseCellAddress,
  parseCellRange as kernelParseCellRange,
  rangeToA1 as kernelRangeToA1,
  rangeAddress as kernelRangeAddress,
  toA1 as kernelToA1,
} from '@mog-sdk/kernel';
import type { IEventBus } from '@mog-sdk/contracts/events';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { ParsedCellAddress, ParsedCellRange } from '@mog-sdk/contracts/utils';
import type {
  IMogDocumentFactory,
  IMogSdkError,
  IMogSdkEventFacade,
  MogSdkDiagnostics,
  MogSdkErrorCode,
  MogSdkSavePathErrorDetails,
} from '@mog-sdk/contracts/sdk';

export interface MogSdkErrorOptions {
  details?: Record<string, unknown> | MogSdkSavePathErrorDetails;
  operation?: string;
  diagnostics?: MogSdkDiagnostics;
  cause?: unknown;
}

export interface MogSdkError extends IMogSdkError {}

export interface MogSdkErrorConstructor {
  new (code: MogSdkErrorCode, message: string, options?: MogSdkErrorOptions): MogSdkError;
  from(error: unknown, operation?: string): MogSdkError;
}

export interface MogSdkEventFacade extends IMogSdkEventFacade {}

export interface MogSdkEventFacadeConstructor {
  new (eventBus: IEventBus, documentId: string): MogSdkEventFacade;
}

export interface PublicA1Utils {
  readonly [name: string]: unknown;
  address(row: number, col: number): string;
  column(index: number): string;
  columnIndex(name: string): number;
  columnName(index: number): string;
  colToLetter(col: number): string;
  offset(ref: string, dr: number, dc: number): string;
  parse(ref: string): ParsedCellAddress | null;
  parseAddress(ref: string): ParsedCellAddress | null;
  parseCellAddress(ref: string): ParsedCellAddress | null;
  parseCellRange(ref: string): ParsedCellRange | null;
  range(row1: number, col1: number, row2: number, col2: number): string;
  rangeAddress(row1: number, col1: number, row2: number, col2: number): string;
  toA1(row: number, col: number): string;
}

export interface PublicRangeUtils {
  readonly [name: string]: unknown;
}

export interface PublicUtils {
  readonly a1: PublicA1Utils;
  readonly range: PublicRangeUtils;
  address(row: number, col: number): string;
  column(index: number): string;
  columnIndex(name: string): number;
  columnName(index: number): string;
  colToLetter(col: number): string;
  offset(ref: string, dr: number, dc: number): string;
  parse(ref: string): ParsedCellAddress | null;
  parseAddress(ref: string): ParsedCellAddress | null;
  parseCellAddress(ref: string): ParsedCellAddress | null;
  parseCellRange(ref: string): ParsedCellRange | null;
  rangeAddress(row1: number, col1: number, row2: number, col2: number): string;
  rangeToA1(range: CellRange, includeSheet?: boolean, sheetName?: string): string;
  toA1(row: number, col: number): string;
}

export const Utils: PublicUtils = KernelUtils as PublicUtils;
export const a1: PublicA1Utils = KernelUtils.a1 as PublicA1Utils;

export const address: (row: number, col: number) => string = kernelAddress;
export const column: (index: number) => string = kernelColumn;
export const columnIndex: (name: string) => number = kernelColumnIndex;
export const columnName: (index: number) => string = kernelColumnName;
export const colToLetter: (col: number) => string = kernelColToLetter;
export const offset: (ref: string, dr: number, dc: number) => string = kernelOffset;
export const parse: (ref: string) => ParsedCellAddress | null = kernelParse;
export const parseAddress: (ref: string) => ParsedCellAddress | null = kernelParseAddress;
export const parseCellAddress: (ref: string) => ParsedCellAddress | null = kernelParseCellAddress;
export const parseCellRange: (ref: string) => ParsedCellRange | null = kernelParseCellRange;
export const rangeToA1: (range: CellRange, includeSheet?: boolean, sheetName?: string) => string =
  kernelRangeToA1;
export const rangeAddress: (row1: number, col1: number, row2: number, col2: number) => string =
  kernelRangeAddress;
export const toA1: (row: number, col: number) => string = kernelToA1;

export const MogDocumentFactory: IMogDocumentFactory = KernelMogDocumentFactory;
export const MogSdkError: MogSdkErrorConstructor = KernelMogSdkError as MogSdkErrorConstructor;
export const MogSdkEventFacade: MogSdkEventFacadeConstructor =
  KernelMogSdkEventFacade as MogSdkEventFacadeConstructor;
