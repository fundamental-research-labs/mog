import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../../../context/types';
import { KernelError } from '../../../errors';
import * as NamedRanges from '../named-ranges';

type Bridge = DocumentContext['computeBridge'];

function buildCtx(bridge: Partial<Bridge>): DocumentContext {
  return { computeBridge: bridge } as unknown as DocumentContext;
}

function expectNamedRangeMutationOptions(value: unknown, sheetIds: string[] = ['sheet1']) {
  expect(value).toEqual(
    expect.objectContaining({
      operationContext: expect.objectContaining({
        domainIds: ['named-ranges'],
        sheetIds,
        capturePolicy: 'commitEligible',
        writeAdmissionMode: 'capture',
      }),
    }),
  );
}

function buildIdentityFormula() {
  return {
    template: '=Sheet1!A1:B2',
    refs: [],
    isDynamicArray: false,
    isVolatile: false,
  };
}

describe('NamedRanges.create', () => {
  it('persists supplied comments after the IdentityFormula-backed create', async () => {
    const createdNames: unknown[] = [];
    const toIdentityFormula = jest.fn(async () => buildIdentityFormula());
    const setNamedRange = jest.fn(async (_name: string, def: any) => {
      createdNames.push({
        id: 'defined-name-1',
        name: def.name,
        refersTo: {
          template: def.refers_to.template,
          refs: [],
        },
        scope: def.scope,
        visible: true,
      });
    });
    const updateNamedRange = jest.fn(async () => undefined);
    const getAllNamedRangesWire = jest.fn(async () => createdNames);
    const ctx = buildCtx({
      toIdentityFormula,
      setNamedRange,
      updateNamedRange,
      getAllNamedRangesWire,
    } as unknown as Partial<Bridge>);

    await NamedRanges.create(
      ctx,
      {
        name: 'BugRange',
        refersToA1: '=Sheet1!A1:B2',
        comment: 'Created from manager',
      },
      sheetId('sheet1'),
      'api',
    );

    const createOptions = setNamedRange.mock.calls[0]?.[2];
    const commentOptions = updateNamedRange.mock.calls[0]?.[2];
    expectNamedRangeMutationOptions(createOptions);
    expectNamedRangeMutationOptions(commentOptions);
    expect((createOptions as any).operationContext.groupId).toBe(
      (commentOptions as any).operationContext.groupId,
    );
    expect((createOptions as any).operationContext.operationId).not.toBe(
      (commentOptions as any).operationContext.operationId,
    );
    expect(setNamedRange).toHaveBeenCalledWith(
      'BugRange',
      expect.objectContaining({
        name: 'BugRange',
        raw_expression: '=Sheet1!A1:B2',
      }),
      expect.anything(),
    );
    expect(updateNamedRange).toHaveBeenCalledWith(
      'defined-name-1',
      {
        name: null,
        refersTo: null,
        comment: 'Created from manager',
        visible: null,
      },
      expect.anything(),
    );
    expect(setNamedRange.mock.invocationCallOrder[0]).toBeLessThan(
      updateNamedRange.mock.invocationCallOrder[0],
    );
  });

  it('does not issue a comment-only update when no non-empty comment is supplied', async () => {
    const toIdentityFormula = jest.fn(async () => buildIdentityFormula());
    const setNamedRange = jest.fn(async () => undefined);
    const updateNamedRange = jest.fn(async () => undefined);
    const getAllNamedRangesWire = jest.fn(async () => []);
    const ctx = buildCtx({
      toIdentityFormula,
      setNamedRange,
      updateNamedRange,
      getAllNamedRangesWire,
    } as unknown as Partial<Bridge>);

    await NamedRanges.create(
      ctx,
      {
        name: 'NoComment',
        refersToA1: '=Sheet1!A1',
        comment: '',
      },
      sheetId('sheet1'),
      'api',
    );

    expect(setNamedRange).toHaveBeenCalledTimes(1);
    expectNamedRangeMutationOptions(setNamedRange.mock.calls[0]?.[2]);
    expect(updateNamedRange).not.toHaveBeenCalled();
    expect(getAllNamedRangesWire).not.toHaveBeenCalled();
  });

  it('fails create if a supplied comment cannot be attached to the created name', async () => {
    const toIdentityFormula = jest.fn(async () => buildIdentityFormula());
    const setNamedRange = jest.fn(async () => undefined);
    const updateNamedRange = jest.fn(async () => undefined);
    const getAllNamedRangesWire = jest.fn(async () => []);
    const ctx = buildCtx({
      toIdentityFormula,
      setNamedRange,
      updateNamedRange,
      getAllNamedRangesWire,
    } as unknown as Partial<Bridge>);

    await expect(
      NamedRanges.create(
        ctx,
        {
          name: 'MissingAfterCreate',
          refersToA1: '=Sheet1!A1',
          comment: 'must persist',
        },
        sheetId('sheet1'),
        'api',
      ),
    ).rejects.toThrow(KernelError);

    expect(setNamedRange).toHaveBeenCalledTimes(1);
    expectNamedRangeMutationOptions(setNamedRange.mock.calls[0]?.[2]);
    expect(updateNamedRange).not.toHaveBeenCalled();
  });

  it('threads mutation context through update and remove writes', async () => {
    const getAllNamedRangesWire = jest.fn(async () => [
      {
        id: 'defined-name-1',
        name: 'BugRange',
        refersTo: { template: '=Sheet1!A1:B2', refs: [] },
        scope: { Sheet: 'sheet1' },
        visible: true,
      },
    ]);
    const updateNamedRange = jest.fn(async () => undefined);
    const removeNamedRangeById = jest.fn(async () => undefined);
    const ctx = buildCtx({
      getAllNamedRangesWire,
      updateNamedRange,
      removeNamedRangeById,
    } as unknown as Partial<Bridge>);

    await NamedRanges.update(
      ctx,
      'defined-name-1',
      { comment: 'updated' },
      sheetId('sheet1'),
      'api',
    );
    await NamedRanges.remove(ctx, 'defined-name-1', 'api');

    expectNamedRangeMutationOptions(updateNamedRange.mock.calls[0]?.[2]);
    expectNamedRangeMutationOptions(removeNamedRangeById.mock.calls[0]?.[1]);
  });
});
