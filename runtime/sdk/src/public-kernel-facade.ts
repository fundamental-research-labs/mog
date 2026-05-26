import {
  Utils as KernelUtils,
  MogDocumentFactory as KernelMogDocumentFactory,
  MogSdkError as KernelMogSdkError,
  MogSdkEventFacade as KernelMogSdkEventFacade,
  colToLetter as kernelColToLetter,
  parseCellAddress as kernelParseCellAddress,
  parseCellRange as kernelParseCellRange,
  rangeToA1 as kernelRangeToA1,
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
} from '@mog-sdk/contracts/sdk';

export interface MogSdkErrorOptions {
  details?: Record<string, unknown>;
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
  colToLetter(col: number): string;
  parseCellAddress(ref: string): ParsedCellAddress | null;
  parseCellRange(ref: string): ParsedCellRange | null;
  toA1(row: number, col: number): string;
}

export interface PublicRangeUtils {
  readonly [name: string]: unknown;
}

export interface PublicUtils extends PublicA1Utils {
  readonly a1: PublicA1Utils;
  readonly range: PublicRangeUtils;
  rangeToA1(range: CellRange, includeSheet?: boolean, sheetName?: string): string;
}

export const Utils: PublicUtils = KernelUtils as PublicUtils;

export const colToLetter: (col: number) => string = kernelColToLetter;
export const parseCellAddress: (ref: string) => ParsedCellAddress | null = kernelParseCellAddress;
export const parseCellRange: (ref: string) => ParsedCellRange | null = kernelParseCellRange;
export const rangeToA1: (range: CellRange, includeSheet?: boolean, sheetName?: string) => string =
  kernelRangeToA1;
export const toA1: (row: number, col: number) => string = kernelToA1;

export const MogDocumentFactory: IMogDocumentFactory = KernelMogDocumentFactory;
export const MogSdkError: MogSdkErrorConstructor = KernelMogSdkError as MogSdkErrorConstructor;
export const MogSdkEventFacade: MogSdkEventFacadeConstructor =
  KernelMogSdkEventFacade as MogSdkEventFacadeConstructor;
