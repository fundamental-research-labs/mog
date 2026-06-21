import { jest } from '@jest/globals';

import { sheetId as makeSheetId } from '@mog-sdk/contracts/core';

import type { MutationAdmissionOptions } from '../../../../bridges/compute';
import { copySheet, createSheet, moveSheet, removeSheet } from '../sheet-crud-operations';

const admissionOptions = {
  operationContext: {
    operationId: 'workbook.sheets.test:1',
    kind: 'mutation',
    author: { authorId: 'test-user', actorKind: 'user' },
    createdAt: '2026-01-01T00:00:00.000Z',
    sheetIds: ['s1'],
    domainIds: ['sheets'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
  },
} as MutationAdmissionOptions;

describe('sheet CRUD operation helpers', () => {
  it('passes admission options to createSheet bridge calls', async () => {
    const sheetId = makeSheetId('s2');
    const computeBridge = {
      createSheet: jest.fn().mockResolvedValue({ sheetId }),
    };

    await expect(createSheet({ computeBridge } as any, 'Revenue', admissionOptions)).resolves.toBe(
      sheetId,
    );
    expect(computeBridge.createSheet).toHaveBeenCalledWith('Revenue', admissionOptions);
  });

  it('passes admission options to removeSheet bridge calls', async () => {
    const sheetId = makeSheetId('s1');
    const computeBridge = {
      removeSheet: jest.fn().mockResolvedValue(undefined),
    };

    await expect(removeSheet({ computeBridge } as any, sheetId, admissionOptions)).resolves.toBe(
      true,
    );
    expect(computeBridge.removeSheet).toHaveBeenCalledWith(sheetId, admissionOptions);
  });

  it('passes admission options to copySheet bridge calls', async () => {
    const sourceSheetId = makeSheetId('s1');
    const newSheetId = makeSheetId('s2');
    const computeBridge = {
      copySheet: jest.fn().mockResolvedValue({ newSheetId }),
    };

    await expect(
      copySheet({ computeBridge } as any, sourceSheetId, 'Revenue Copy', admissionOptions),
    ).resolves.toBe(newSheetId);
    expect(computeBridge.copySheet).toHaveBeenCalledWith(
      sourceSheetId,
      'Revenue Copy',
      admissionOptions,
    );
  });

  it('passes admission options to moveSheet bridge calls', async () => {
    const sheetId = makeSheetId('s1');
    const computeBridge = {
      moveSheet: jest.fn().mockResolvedValue(undefined),
    };

    await expect(moveSheet({ computeBridge } as any, sheetId, 2, admissionOptions)).resolves.toBe(
      true,
    );
    expect(computeBridge.moveSheet).toHaveBeenCalledWith(sheetId, 2, admissionOptions);
  });
});
