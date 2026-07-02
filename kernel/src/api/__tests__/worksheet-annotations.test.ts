import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import type { AnnotationRecord } from '../../bridges/compute/compute-types.gen';
import { WorksheetAnnotationsImpl } from '../worksheet/annotations';

const SHEET_ID = sheetId('sheet-annotations');

function makeRecord(overrides: Partial<AnnotationRecord> = {}): AnnotationRecord {
  return {
    schemaVersion: 1,
    id: 'ann-1',
    anchorId: 'cell-a',
    text: 'Revenue source cell',
    status: 'fresh',
    fingerprint: {
      profile: 'cellText',
      canonicalizer: 'test',
      hash: 'sha256:test',
    },
    createdAt: 10,
    updatedAt: 20,
    checkedAt: 30,
    ...overrides,
  };
}

function mutationData(data: unknown) {
  return { data };
}

function createCtx() {
  return {
    clock: { now: () => 1_700_000_000_000 },
    workbookLinkScope: jest.fn(() => ({
      actor: 'api-test',
      requestingSessionId: 'session-1',
      requestingDocumentId: 'doc-1',
    })),
    writeGate: {
      assertWritable: jest.fn(),
    },
    eventBus: {
      emit: jest.fn(),
    },
    computeBridge: {
      setCellAnnotationByPosition: jest.fn(),
      getCellAnnotationByPosition: jest.fn(),
      removeCellAnnotationByPosition: jest.fn(),
      listCellAnnotations: jest.fn(),
      resolveCellPositions: jest.fn(),
      getAllTablesInSheet: jest.fn().mockResolvedValue([]),
      setTableAnnotation: jest.fn(),
      getTableAnnotation: jest.fn(),
      removeTableAnnotation: jest.fn(),
      listTableAnnotations: jest.fn().mockResolvedValue([]),
    },
  } as any;
}

describe('WorksheetAnnotationsImpl cell API', () => {
  it('safe get hides stale text while diagnostics can expose it', async () => {
    const ctx = createCtx();
    const stale = makeRecord({
      status: 'stale',
      staleReason: 'fingerprintMismatch',
      text: 'Old meaning',
    });
    ctx.computeBridge.getCellAnnotationByPosition.mockResolvedValue(stale);
    const api = new WorksheetAnnotationsImpl(ctx, SHEET_ID);

    await expect(api.cells.get('B2')).resolves.toEqual({
      id: stale.id,
      anchorId: stale.anchorId,
      status: 'stale',
      staleReason: 'fingerprintMismatch',
      updatedAt: stale.updatedAt,
      checkedAt: stale.checkedAt,
      row: 1,
      col: 1,
      currentRef: 'B2',
    });
    await expect(api.cells.getText('B2')).resolves.toBeNull();
    await expect(api.cells.diagnostics.get('B2')).resolves.toBeNull();
    await expect(api.cells.diagnostics.get('B2', { includeStale: true })).resolves.toMatchObject({
      text: 'Old meaning',
      status: 'stale',
      row: 1,
      col: 1,
      currentRef: 'B2',
    });
  });

  it('set writes through the compute bridge and emits a cellAnnotation event', async () => {
    const ctx = createCtx();
    const record = makeRecord({ anchorId: 'cell-c3', id: 'ann-c3' });
    ctx.computeBridge.setCellAnnotationByPosition.mockResolvedValue(mutationData(record));
    const api = new WorksheetAnnotationsImpl(ctx, SHEET_ID);

    const result = await api.cells.set('C3', 'Check this');

    expect(result).toMatchObject({ id: 'ann-c3', currentRef: 'C3', row: 2, col: 2 });
    expect(ctx.computeBridge.setCellAnnotationByPosition).toHaveBeenCalledWith(
      SHEET_ID,
      2,
      2,
      'Check this',
      expect.objectContaining({
        operationContext: expect.objectContaining({
          domainIds: ['annotations'],
          capturePolicy: 'excluded',
          writeAdmissionMode: 'captureDisabledNoHistory',
        }),
      }),
    );
    expect(ctx.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'cellAnnotation:changed',
        sheetId: SHEET_ID,
        row: 2,
        col: 2,
        anchorId: 'cell-c3',
        annotationId: 'ann-c3',
        status: 'fresh',
        action: 'set',
        source: 'api',
      }),
    );
  });

  it('lists safe views with current refs and range filtering', async () => {
    const ctx = createCtx();
    const fresh = makeRecord({ id: 'fresh', anchorId: 'cell-a1', text: 'Fresh text' });
    const stale = makeRecord({
      id: 'stale',
      anchorId: 'cell-c3',
      status: 'stale',
      text: 'Hidden stale text',
    });
    ctx.computeBridge.listCellAnnotations.mockResolvedValue([fresh, stale]);
    ctx.computeBridge.resolveCellPositions.mockResolvedValue([
      { sheetId: SHEET_ID, sheetName: 'Sheet1', row: 0, col: 0 },
      { sheetId: SHEET_ID, sheetName: 'Sheet1', row: 2, col: 2 },
    ]);
    const api = new WorksheetAnnotationsImpl(ctx, SHEET_ID);

    const listed = await api.cells.list();
    expect(listed).toEqual([
      expect.objectContaining({ id: 'fresh', text: 'Fresh text', currentRef: 'A1' }),
      expect.objectContaining({ id: 'stale', currentRef: 'C3' }),
    ]);
    expect(listed[1]).not.toHaveProperty('text');
    await expect(api.cells.list({ range: 'A1:A1' })).resolves.toEqual([
      expect.objectContaining({ id: 'fresh', currentRef: 'A1' }),
    ]);
  });

  it('clear removes reachable annotations and emits a clear event', async () => {
    const ctx = createCtx();
    const first = makeRecord({ id: 'ann-a1', anchorId: 'cell-a1' });
    ctx.computeBridge.listCellAnnotations.mockResolvedValue([first]);
    ctx.computeBridge.resolveCellPositions.mockResolvedValue([
      { sheetId: SHEET_ID, sheetName: 'Sheet1', row: 0, col: 0 },
    ]);
    ctx.computeBridge.removeCellAnnotationByPosition.mockResolvedValue(
      mutationData({
        anchorId: 'cell-a1',
        removed: true,
        annotation: first,
      }),
    );
    const api = new WorksheetAnnotationsImpl(ctx, SHEET_ID);

    await api.cells.clear('A1:A1');

    expect(ctx.computeBridge.removeCellAnnotationByPosition).toHaveBeenCalledWith(
      SHEET_ID,
      0,
      0,
      expect.any(Object),
    );
    expect(ctx.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'cellAnnotations:cleared',
        sheetId: SHEET_ID,
        range: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
        source: 'api',
      }),
    );
  });
});
