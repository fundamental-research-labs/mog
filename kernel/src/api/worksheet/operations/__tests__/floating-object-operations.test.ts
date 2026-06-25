import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import { copyToSheet, updateFloatingObject, updatePicture } from '../floating-object-operations';

const SHEET_ID = sheetId('sheet-1');
const TARGET_SHEET_ID = sheetId('sheet-2');

function pictureWire(id = 'picture-1', sheet = SHEET_ID): Record<string, unknown> {
  return {
    id,
    type: 'picture',
    sheetId: sheet,
    anchor: {
      anchorRow: 1,
      anchorCol: 2,
      anchorRowOffsetEmu: 19_050,
      anchorColOffsetEmu: 9_525,
      anchorMode: 'oneCell',
    },
    width: 100,
    height: 50,
    src: 'data:image/png;base64,AA==',
  };
}

function createMockCtx() {
  return {
    clock: {
      now: jest.fn(() => 1_700_000_000_000),
    },
    computeBridge: {
      getFloatingObjectTyped: jest.fn(async (sheet: string, objectId: string) =>
        pictureWire(objectId, sheetId(sheet)),
      ),
      updateFloatingObject: jest.fn().mockResolvedValue({ floatingObjectChanges: [] }),
      resizeFloatingObjectTyped: jest.fn().mockResolvedValue({ floatingObjectChanges: [] }),
      moveFloatingObjectTyped: jest.fn().mockResolvedValue({ floatingObjectChanges: [] }),
      duplicateFloatingObjectTyped: jest.fn().mockResolvedValue({
        floatingObjectChanges: [{ objectId: 'picture-copy-1', kind: { type: 'created' } }],
      }),
      computeAllObjectBounds: jest
        .fn()
        .mockResolvedValue([
          ['picture-copy-1', { x: 0, y: 0, width: 100, height: 50, rotation: 0 }],
        ]),
    },
    workbookLinkScope: jest.fn(() => ({
      actor: 'user-1',
      requestingDocumentId: 'workbook-1',
      requestingSessionId: 'session-1',
    })),
  } as any;
}

function expectFloatingObjectAdmissionOptions(
  operationIdPrefix: string,
  sheetIds: readonly string[] = [SHEET_ID],
  groupId?: string,
) {
  return expect.objectContaining({
    operationContext: expect.objectContaining({
      operationId: expect.stringMatching(
        new RegExp(`^${operationIdPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`),
      ),
      kind: 'mutation',
      sheetIds: [...sheetIds],
      domainIds: ['floating-objects.anchors'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
      ...(groupId ? { groupId } : {}),
    }),
  });
}

function lastCallArg(mock: jest.Mock, indexFromEnd = 0): unknown {
  const call = mock.mock.calls.at(-1);
  if (!call) return undefined;
  return call[call.length - 1 - indexFromEnd];
}

describe('floating object operation admission contexts', () => {
  it('passes a floatingObjects.update context to generic object updates', async () => {
    const ctx = createMockCtx();

    await updateFloatingObject(ctx, SHEET_ID, 'picture-1', { name: 'Updated' });

    expect(ctx.computeBridge.updateFloatingObject).toHaveBeenCalledWith(
      SHEET_ID,
      'picture-1',
      { name: 'Updated' },
      expectFloatingObjectAdmissionOptions('floatingObjects.update'),
    );
  });

  it('uses one grouped context for multi-step picture updates', async () => {
    const ctx = createMockCtx();

    await updatePicture(ctx, SHEET_ID, 'picture-1', {
      name: 'Updated',
      width: 240,
      anchorCell: { row: 3, col: 4 },
      x: 12,
      y: 24,
    });

    const options = [
      lastCallArg(ctx.computeBridge.updateFloatingObject),
      lastCallArg(ctx.computeBridge.resizeFloatingObjectTyped),
      lastCallArg(ctx.computeBridge.moveFloatingObjectTyped),
    ] as Array<{ operationContext: { groupId?: string } }>;
    const groupId = options[0].operationContext.groupId;

    for (const option of options) {
      expect(option).toEqual(
        expectFloatingObjectAdmissionOptions('floatingObjects.update', [SHEET_ID], groupId),
      );
    }
  });

  it('includes source and target sheets in grouped cross-sheet copy contexts', async () => {
    const ctx = createMockCtx();

    await copyToSheet(ctx, SHEET_ID, 'picture-1', TARGET_SHEET_ID);

    const duplicateOptions = lastCallArg(ctx.computeBridge.duplicateFloatingObjectTyped);
    const updateOptions = lastCallArg(ctx.computeBridge.updateFloatingObject);
    const groupId = (duplicateOptions as { operationContext: { groupId?: string } })
      .operationContext.groupId;

    expect(duplicateOptions).toEqual(
      expectFloatingObjectAdmissionOptions(
        'floatingObjects.duplicate',
        [SHEET_ID, TARGET_SHEET_ID],
        groupId,
      ),
    );
    expect(updateOptions).toEqual(
      expectFloatingObjectAdmissionOptions(
        'floatingObjects.duplicate',
        [SHEET_ID, TARGET_SHEET_ID],
        groupId,
      ),
    );
  });
});
