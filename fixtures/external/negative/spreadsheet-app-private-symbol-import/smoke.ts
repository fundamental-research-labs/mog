// Private implementation types must not be importable or inferable through
// @mog-sdk/spreadsheet-app public declarations.

import type {
  ComputeBridge,
  DocumentContext,
  DocumentManager,
  MogSpreadsheetDocumentPolicy,
  ShellBootstrapResult,
  uiStore,
} from '@mog-sdk/spreadsheet-app';

type Forbidden =
  | ComputeBridge
  | DocumentContext
  | DocumentManager
  | MogSpreadsheetDocumentPolicy
  | ShellBootstrapResult
  | typeof uiStore;

export type { Forbidden };
