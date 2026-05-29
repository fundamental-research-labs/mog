import { jest } from '@jest/globals';
import type { SheetId } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../../context/types';
import {
  maskExternalFormulaRefsForValidation,
  materializeExternalFormulas,
  prepareExternalFormulaWrite,
} from '../external-formulas';
import { registerExternalWorkbookSession } from '../workbook-links/session-registry';
import { createWorkbookLinkService, type WorkbookLinkStatusScope } from '../workbook-links';

function scope(): WorkbookLinkStatusScope {
  return {
    requestingDocumentId: 'target-doc',
    requestingSessionId: 'target-session',
    actor: 'agent',
    principal: { tags: [] },
  };
}

function createContext(sourceValues: Record<string, Record<string, unknown>>): DocumentContext {
  const workbookLinks = createWorkbookLinkService({
    resolver: {
      resolve: (request) => ({
        linkId: request.linkId,
        status: 'ready',
        sourceSessionId: 'source-session',
        sourceWorkbookId: request.expectedWorkbookId ?? undefined,
        sourceVersion: 'v1',
        authorization: 'read',
      }),
    },
    now: () => '2026-05-29T00:00:00.000Z',
  });
  workbookLinks.create({
    linkId: 'link-budget',
    expectedWorkbookId: 'source-workbook',
    target: { kind: 'open-session', sessionId: 'source-session' },
    displayName: 'Budget.xlsx',
    sourceKind: 'mog-workbook',
  });

  const computeBridge = {
    setCellsByPosition: jest.fn(async () => ({ success: true })),
  };

  return {
    workbookLinks,
    workbookLinkScope: scope,
    computeBridge,
  } as unknown as DocumentContext;
}

describe('external formula materialization', () => {
  let unregister: (() => void) | undefined;

  afterEach(() => {
    unregister?.();
    unregister = undefined;
  });

  it('materializes external single-cell writes before they reach compute', async () => {
    const sourceValues = { Inputs: { A1: 125 } };
    unregister = registerExternalWorkbookSession('source-session', {
      workbook: {
        async getSheet(name: string) {
          return {
            async getValue(address: string) {
              return sourceValues[name]?.[address] ?? null;
            },
          };
        },
      },
    });
    const ctx = createContext(sourceValues);

    await expect(
      prepareExternalFormulaWrite(ctx, 'sheet-1' as SheetId, 0, 0, '=[Budget.xlsx]Inputs!A1'),
    ).resolves.toBe('=125');
  });

  it('retains the original external formula for later recalculation', async () => {
    const sourceValues = { Inputs: { A1: 125 } };
    unregister = registerExternalWorkbookSession('source-session', {
      workbook: {
        async getSheet(name: string) {
          return {
            async getValue(address: string) {
              return sourceValues[name]?.[address] ?? null;
            },
          };
        },
      },
    });
    const ctx = createContext(sourceValues);
    const sheetId = 'sheet-1' as SheetId;

    await prepareExternalFormulaWrite(ctx, sheetId, 0, 0, '=[Budget.xlsx]Inputs!A1');
    sourceValues.Inputs.A1 = 200;
    await expect(materializeExternalFormulas(ctx)).resolves.toBe(1);

    expect(ctx.computeBridge.setCellsByPosition).toHaveBeenCalledWith(sheetId, [
      { row: 0, col: 0, input: { kind: 'parse', text: '=200' } },
    ]);
  });

  it('materializes external range references as array constants', async () => {
    const sourceValues = { Inputs: { A1: 125, A2: 25 } };
    unregister = registerExternalWorkbookSession('source-session', {
      workbook: {
        async getSheet(name: string) {
          return {
            async getValue(address: string) {
              return sourceValues[name]?.[address] ?? null;
            },
          };
        },
      },
    });
    const ctx = createContext(sourceValues);

    await expect(
      prepareExternalFormulaWrite(
        ctx,
        'sheet-1' as SheetId,
        1,
        0,
        '=SUM([Budget.xlsx]Inputs!A1:A2)',
      ),
    ).resolves.toBe('=SUM({125;25})');
  });

  it('masks external references for interactive syntax and circular validation', () => {
    expect(maskExternalFormulaRefsForValidation('=[Budget.xlsx]Inputs!A1')).toBe('=0');
    expect(maskExternalFormulaRefsForValidation('=SUM([Budget.xlsx]Inputs!A1:A2)+A1')).toBe(
      '=SUM(0)+A1',
    );
  });
});
