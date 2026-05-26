// Each of these must fail to resolve outside the monorepo.
// @mog/types-* packages are workspace-internal and not published.

import type { CellStyle } from '@mog/types-core';
import type { WorkbookSnapshot } from '@mog/types-api';
import type { BridgeMethod } from '@mog/types-bridges';
import type { DocumentState } from '@mog-sdk/types-document';
import type { SpreadsheetEvent } from '@mog/types-events';
import type { CellFormat } from '@mog/types-formatting';
import type { TrustedDocumentHostContext } from '@mog-sdk/types-host';
import type { KernelHostContext } from '@mog-sdk/types-host/kernel';
