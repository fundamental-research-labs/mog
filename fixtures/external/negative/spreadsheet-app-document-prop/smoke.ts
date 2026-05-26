// MogSpreadsheetApp must attach to an existing runtime-owned workbook session.
// It must not accept workbook source bytes or a component-owned document prop.

import type {
  MogSpreadsheetAppProps,
  SpreadsheetRuntime,
  SpreadsheetWorkbookSession,
} from '@mog-sdk/spreadsheet-app';

declare const runtime: SpreadsheetRuntime;
declare const workbook: SpreadsheetWorkbookSession;

const props: MogSpreadsheetAppProps = {
  runtime,
  workbook,
  document: {
    source: { kind: 'blank' },
  },
};

void props;
