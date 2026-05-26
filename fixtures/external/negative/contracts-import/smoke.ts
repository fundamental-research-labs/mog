// These imports must ALL fail to resolve outside the monorepo.
// @mog-sdk/spreadsheet-contracts is workspace-internal and not published.

// Root import must fail
import type { CellFormat } from '@mog-sdk/spreadsheet-contracts';

// Subpath imports must fail
import type { CellValue } from '@mog-sdk/spreadsheet-contracts/core';
import type { Workbook } from '@mog-sdk/spreadsheet-contracts/api';
