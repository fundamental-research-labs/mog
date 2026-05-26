import { MAX_COLS, MAX_ROWS, sheetId, type CellValue, type SheetId } from '@mog-sdk/contracts';
import type { CellValue as CoreCellValue, SheetId as CoreSheetId } from '@mog-sdk/contracts/core';
import type { Workbook } from '@mog-sdk/contracts/api';
import type { DocumentSource } from '@mog-sdk/contracts/document';
import type { StorageProviderConfig } from '@mog-sdk/contracts/storage';
import type { SpreadsheetEvent } from '@mog-sdk/contracts/events';
import type { Command } from '@mog-sdk/contracts/commands';
import type { Workbook as NodeWorkbook } from '@mog-sdk/node';
import type { SpreadsheetWorkbookFacade } from '@mog-sdk/spreadsheet-app';

const id: SheetId = sheetId('fixture-sheet');
const coreId: CoreSheetId = id;
const backToRootId: SheetId = coreId;

const value: CellValue = 42;
const coreValue: CoreCellValue = value;
const backToRootValue: CellValue = coreValue;

const source: DocumentSource = { type: 'bytes', data: new Uint8Array([80, 75, 3, 4]) };
const provider: StorageProviderConfig = {
  kind: 'memory',
  providerRefId: 'fixture-memory',
  storageScope: {
    kind: 'explicit-no-scope',
    reason: 'deterministic-test-fixture',
  },
  contractVersion: '1.0.0',
  providerProtocolVersion: '1.0.0',
  role: 'authority',
  required: true,
};
const event: SpreadsheetEvent | undefined = undefined;
const command: Command | undefined = undefined;
const nodeWorkbook: NodeWorkbook | undefined = undefined;
const appWorkbook: SpreadsheetWorkbookFacade | undefined = undefined;
const contractWorkbook: Workbook | undefined = nodeWorkbook ?? appWorkbook;

void backToRootId;
void backToRootValue;
void source;
void provider;
void event;
void command;
void contractWorkbook;
void MAX_ROWS;
void MAX_COLS;
