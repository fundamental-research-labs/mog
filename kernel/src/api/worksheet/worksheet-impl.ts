/**
 * WorksheetImpl — Unified Worksheet Implementation
 *
 * THE single implementation of the Worksheet interface. Every consumer —
 * headless agents, LLM code, OS apps, browser app — uses this.
 *
 * @see contracts/src/api/worksheet.ts — Interface definition
 */

import type { SheetId, Workbook, Worksheet } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import type { SpreadsheetObjectManager } from '../../floating-objects';
import type { HandleLiveness } from '../lifecycle/handle-liveness';
import { WorksheetImplNamespaces } from './worksheet-impl-namespaces';

export class WorksheetImpl extends WorksheetImplNamespaces implements Worksheet {
  constructor(
    sheetId: SheetId,
    ctx: DocumentContext,
    options?: {
      workbook?: Workbook | null;
      name?: string;
      index?: number;
      visible?: boolean;
      floatingObjectManager?: SpreadsheetObjectManager;
      liveness?: HandleLiveness;
    },
  ) {
    super(sheetId, ctx, options);
  }
}
