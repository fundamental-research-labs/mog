import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

const namedRangesGetByNameMock = jest.fn();
const namedRangesGetByIdMock = jest.fn();
const namedRangesGetRefersToA1Mock = jest.fn();
const namedRangesCreateMock = jest.fn();
const namedRangesUpdateMock = jest.fn();
const namedRangesRemoveMock = jest.fn();
const namedRangesExportNamesMock = jest.fn();

jest.unstable_mockModule('../../../domain/formulas/named-ranges', () => ({
  getByName: namedRangesGetByNameMock,
  getById: namedRangesGetByIdMock,
  getRefersToA1: namedRangesGetRefersToA1Mock,
  create: namedRangesCreateMock,
  update: namedRangesUpdateMock,
  remove: namedRangesRemoveMock,
  exportNames: namedRangesExportNamesMock,
}));

const { WorkbookNamesImpl } = await import('../names');
const NamedRanges = await import('../../../domain/formulas/named-ranges');

const SHEET_ID = sheetId('sheet1');

function definedName(overrides: Record<string, unknown> = {}) {
  return {
    id: 'nr-1',
    name: 'Revenue',
    refersTo: { template: '{0}', refs: [] },
    refersToA1: '=Sheet1!A1:B10',
    visible: true,
    ...overrides,
  };
}

function createNamesApi() {
  return new WorkbookNamesImpl({
    ctx: {
      writeGate: {
        assertWritable: jest.fn(),
      },
    } as any,
    getActiveSheetId: () => SHEET_ID,
    resolveSheetNameToId: jest.fn(async (nameLower: string) =>
      nameLower === 'sheet1' ? SHEET_ID : undefined,
    ),
    getSheetName: jest.fn(async (id) => (id === SHEET_ID ? 'Sheet1' : undefined)),
    getKnownSheetNames: jest.fn(async () => ['Sheet1']),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (NamedRanges.getRefersToA1 as jest.Mock).mockImplementation(
    async (_ctx: unknown, name: any) => {
      return name.refersToA1 ?? '=Sheet1!A1';
    },
  );
});

describe('WorkbookNamesImpl receipts', () => {
  it('returns a base receipt with created object and range effects for add', async () => {
    const created = definedName({ comment: 'gross sales' });
    (NamedRanges.getByName as jest.Mock)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(created);
    (NamedRanges.create as jest.Mock).mockResolvedValue(undefined);

    const receipt = await createNamesApi().add('Revenue', 'Sheet1!A1:B10', 'gross sales');

    expect(receipt).toMatchObject({
      kind: 'nameAdd',
      status: 'applied',
      name: 'Revenue',
      reference: 'Sheet1!A1:B10',
      created: {
        id: 'nr-1',
        name: 'Revenue',
        reference: 'Sheet1!A1:B10',
        comment: 'gross sales',
      },
      effects: [
        expect.objectContaining({
          type: 'createdObject',
          objectId: 'nr-1',
          range: 'Sheet1!A1:B10',
        }),
        expect.objectContaining({
          type: 'changedRange',
          range: 'Sheet1!A1:B10',
        }),
      ],
      diagnostics: [],
    });
    expect(NamedRanges.create).toHaveBeenCalledWith(
      expect.anything(),
      {
        name: 'Revenue',
        refersToA1: '=Sheet1!A1:B10',
        comment: 'gross sales',
        scope: undefined,
      },
      SHEET_ID,
      'api',
    );
  });

  it('returns previous and updated payloads for update', async () => {
    const previous = definedName();
    const updated = definedName({
      name: 'Revenue2026',
      refersToA1: '=Sheet1!C1:C10',
    });
    (NamedRanges.getByName as jest.Mock).mockResolvedValueOnce(previous);
    (NamedRanges.getById as jest.Mock).mockResolvedValueOnce(updated);
    (NamedRanges.update as jest.Mock).mockResolvedValue(undefined);

    const receipt = await createNamesApi().update('Revenue', {
      name: 'Revenue2026',
      reference: 'Sheet1!C1:C10',
    });

    expect(NamedRanges.update).toHaveBeenCalledWith(
      expect.anything(),
      'nr-1',
      expect.objectContaining({
        name: 'Revenue2026',
        refersToA1: '=Sheet1!C1:C10',
      }),
      SHEET_ID,
    );
    expect(receipt).toMatchObject({
      kind: 'nameUpdate',
      status: 'applied',
      name: 'Revenue',
      previous: {
        id: 'nr-1',
        name: 'Revenue',
        reference: 'Sheet1!A1:B10',
      },
      updated: {
        id: 'nr-1',
        name: 'Revenue2026',
        reference: 'Sheet1!C1:C10',
      },
      effects: [
        expect.objectContaining({
          type: 'updatedObject',
          objectId: 'nr-1',
          range: 'Sheet1!C1:C10',
        }),
        expect.objectContaining({
          type: 'changedRange',
          range: 'Sheet1!C1:C10',
        }),
      ],
      diagnostics: [],
    });
  });

  it('returns removed payloads for removeById', async () => {
    const removed = definedName({ scope: SHEET_ID });
    (NamedRanges.getById as jest.Mock).mockResolvedValueOnce(removed);
    (NamedRanges.remove as jest.Mock).mockResolvedValue(undefined);

    const receipt = await createNamesApi().removeById('nr-1');

    expect(NamedRanges.remove).toHaveBeenCalledWith(expect.anything(), 'nr-1', 'api');
    expect(receipt).toMatchObject({
      kind: 'nameRemove',
      status: 'applied',
      name: 'Revenue',
      removed: {
        id: 'nr-1',
        name: 'Revenue',
        reference: 'Sheet1!A1:B10',
        scope: 'Sheet1',
        scopeSheetId: SHEET_ID,
      },
      effects: [
        expect.objectContaining({
          type: 'removedObject',
          sheetId: SHEET_ID,
          objectId: 'nr-1',
          range: 'Sheet1!A1:B10',
        }),
        expect.objectContaining({
          type: 'changedRange',
          sheetId: SHEET_ID,
          range: 'Sheet1!A1:B10',
        }),
      ],
      diagnostics: [],
    });
  });

  it('returns worksheetUnchanged for an empty clear', async () => {
    (NamedRanges.exportNames as jest.Mock).mockResolvedValueOnce([]);

    await expect(createNamesApi().clear()).resolves.toMatchObject({
      kind: 'nameClear',
      status: 'noOp',
      removed: [],
      removedCount: 0,
      effects: [expect.objectContaining({ type: 'worksheetUnchanged' })],
      diagnostics: [],
    });
  });
});
