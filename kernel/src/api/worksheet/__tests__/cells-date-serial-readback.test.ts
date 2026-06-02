/**
 * Regression coverage for date-formatted Excel serial readback.
 *
 * The undesired behavior is that agent-facing cell reads expose date-formatted
 * serials as bare numbers. These tests document the safe read contract without
 * changing production code: callers need the raw serial, display text,
 * unambiguous parsed calendar date, and explicit Excel date-system conversion
 * metadata so they do not hand-roll JavaScript Date math.
 */

import { jest } from '@jest/globals';
import { sheetId } from '@mog-sdk/contracts/core';
import type { DocumentContext } from '../../../context/types';
import { WorksheetImpl } from '../worksheet-impl';

type Bridge = DocumentContext['computeBridge'];

const SHEET_ID = sheetId('sheet-date-serials');
const DATE_FORMAT = 'm/d/yyyy';

type ParsedDate = {
  isoDate: string;
  year: number;
  month: number;
  day: number;
};

type SafeDateSemantics = {
  rawSerial: number;
  displayValue: string;
  parsedDate: ParsedDate | null;
  dateSystem: 'excel1900';
  conversionHelper: {
    kind: 'excelSerialDate';
    dateSystem: 'excel1900';
    lotus1900LeapYearBug: true;
    serial60IsFakeLeapDay: boolean;
    unambiguous: boolean;
  };
};

const SERIAL_FIXTURES: Array<{
  serial: number;
  displayValue: string;
  parsedDate: ParsedDate;
}> = [
  {
    serial: 42170,
    displayValue: '6/15/2015',
    parsedDate: { isoDate: '2015-06-15', year: 2015, month: 6, day: 15 },
  },
  {
    serial: 42993,
    displayValue: '9/15/2017',
    parsedDate: { isoDate: '2017-09-15', year: 2017, month: 9, day: 15 },
  },
  {
    serial: 43723,
    displayValue: '9/15/2019',
    parsedDate: { isoDate: '2019-09-15', year: 2019, month: 9, day: 15 },
  },
];

const LEAP_YEAR_EDGE_FIXTURES: Array<{
  serial: number;
  displayValue: string;
  parsedDate: ParsedDate | null;
  serial60IsFakeLeapDay: boolean;
  unambiguous: boolean;
}> = [
  {
    serial: 59,
    displayValue: '2/28/1900',
    parsedDate: { isoDate: '1900-02-28', year: 1900, month: 2, day: 28 },
    serial60IsFakeLeapDay: false,
    unambiguous: true,
  },
  {
    serial: 60,
    displayValue: '2/29/1900',
    parsedDate: null,
    serial60IsFakeLeapDay: true,
    unambiguous: false,
  },
  {
    serial: 61,
    displayValue: '3/1/1900',
    parsedDate: { isoDate: '1900-03-01', year: 1900, month: 3, day: 1 },
    serial60IsFakeLeapDay: false,
    unambiguous: true,
  },
];

function buildCtx(bridge: Partial<Bridge>): DocumentContext {
  return {
    computeBridge: bridge,
  } as unknown as DocumentContext;
}

function makeWs(bridge: Partial<Bridge>): WorksheetImpl {
  return new WorksheetImpl(SHEET_ID, buildCtx(bridge));
}

function makeExpectedDateSemantics(
  serial: number,
  displayValue: string,
  parsedDate: ParsedDate | null,
  overrides: Partial<SafeDateSemantics['conversionHelper']> = {},
): SafeDateSemantics {
  return {
    rawSerial: serial,
    displayValue,
    parsedDate,
    dateSystem: 'excel1900',
    conversionHelper: {
      kind: 'excelSerialDate',
      dateSystem: 'excel1900',
      lotus1900LeapYearBug: true,
      serial60IsFakeLeapDay: false,
      unambiguous: true,
      ...overrides,
    },
  };
}

function makeDateSerialBridge(serial: number, displayValue: string): Partial<Bridge> {
  return {
    getCellIdAt: jest.fn(async () => `date-serial-${serial}`),
    getActiveCell: jest.fn(async () => ({
      cellId: `date-serial-${serial}`,
      value: serial,
      metadata: { region: null },
      isFormulaHidden: false,
    })),
    queryRange: jest.fn(async () => ({
      cells: [{ row: 0, col: 0, value: serial, format: { numberFormat: DATE_FORMAT } }],
      merges: [],
    })),
    getDisplayValue: jest.fn(async () => displayValue),
  } as unknown as Partial<Bridge>;
}

describe('date-formatted Excel serial read APIs', () => {
  it.each(SERIAL_FIXTURES)(
    'Worksheet.cells.get exposes safe date semantics for Excel 1900 serial $serial',
    async ({ serial, displayValue, parsedDate }) => {
      const ws = makeWs(makeDateSerialBridge(serial, displayValue));

      const record = await ws.cells.get('A1');

      expect(record).toEqual(
        expect.objectContaining({
          value: serial,
          date: makeExpectedDateSemantics(serial, displayValue, parsedDate),
        }),
      );
    },
  );

  it.each(LEAP_YEAR_EDGE_FIXTURES)(
    'Worksheet.cells.get handles Excel 1900 leap-year edge serial $serial without ambiguous JS Date coercion',
    async ({ serial, displayValue, parsedDate, serial60IsFakeLeapDay, unambiguous }) => {
      const ws = makeWs(makeDateSerialBridge(serial, displayValue));

      const record = await ws.cells.get('A1');

      expect(record).toEqual(
        expect.objectContaining({
          value: serial,
          date: makeExpectedDateSemantics(serial, displayValue, parsedDate, {
            serial60IsFakeLeapDay,
            unambiguous,
          }),
        }),
      );
    },
  );

  it('Worksheet.getCell also carries the same safe date semantics alongside raw value and formatted text', async () => {
    const serial = 42170;
    const displayValue = '6/15/2015';
    const parsedDate = { isoDate: '2015-06-15', year: 2015, month: 6, day: 15 };
    const ws = makeWs(makeDateSerialBridge(serial, displayValue));

    const cell = await ws.getCell('A1');

    expect(cell).toEqual(
      expect.objectContaining({
        value: serial,
        formatted: displayValue,
        format: expect.objectContaining({ numberFormat: DATE_FORMAT }),
        date: makeExpectedDateSemantics(serial, displayValue, parsedDate),
      }),
    );
  });
});
