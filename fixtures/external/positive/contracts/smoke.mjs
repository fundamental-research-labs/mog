import { MAX_COLS, MAX_ROWS, sheetId } from '@mog-sdk/contracts';
import { sheetId as coreSheetId } from '@mog-sdk/contracts/core';

if (typeof MAX_ROWS !== 'number' || MAX_ROWS <= 0) {
  throw new Error('MAX_ROWS must be a positive number');
}

if (typeof MAX_COLS !== 'number' || MAX_COLS <= 0) {
  throw new Error('MAX_COLS must be a positive number');
}

if (sheetId('fixture') !== coreSheetId('fixture')) {
  throw new Error('root and core sheetId constructors must share runtime identity');
}
