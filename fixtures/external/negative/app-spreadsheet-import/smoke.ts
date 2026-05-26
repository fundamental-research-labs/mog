// @mog/app-spreadsheet is private: not a public gateway.
// All of these imports must fail outside the monorepo.

import { SpreadsheetApp } from '@mog/app-spreadsheet';

// Convenience re-export subpaths must also fail
import { createWorkbook } from '@mog/app-spreadsheet/kernel-api';
import { createShell } from '@mog/app-spreadsheet/shell';
import { SheetView } from '@mog/app-spreadsheet/sheet-view';
