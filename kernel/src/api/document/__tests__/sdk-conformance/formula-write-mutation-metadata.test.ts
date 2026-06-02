/**
 * Regression coverage for formula writes in mutation/change metadata.
 *
 * The trace/code-execution path writes formulas through the public worksheet API
 * with `{ asFormula: true }`, then builds dirty-cell summaries from workbook
 * change records. Direct formula writes must remain formula writes in that
 * metadata; they must not look like hardcoded writes of the computed value.
 */

import { MogDocumentFactory } from '../../mog-document-factory';

import type { Workbook, WorkbookChangeRecord, Worksheet } from '@mog-sdk/contracts/api';
import type { MogDocument } from '@mog-sdk/contracts/sdk';

type FormulaMetadataRecord = WorkbookChangeRecord & {
  formula?: string | null;
};

type FormulaCase = {
  label: string;
  address: string;
  input: string;
  formula: string;
  expectedValue?: unknown;
};

const cases: FormulaCase[] = [
  {
    label: 'number result',
    address: 'A1',
    input: '1+1',
    formula: '=1+1',
    expectedValue: 2,
  },
  {
    label: 'string result',
    address: 'B1',
    input: '"hello"',
    formula: '="hello"',
    expectedValue: 'hello',
  },
  {
    label: 'error result',
    address: 'C1',
    input: '1/0',
    formula: '=1/0',
  },
  {
    label: 'blank string result',
    address: 'D1',
    input: 'IF(FALSE,1,"")',
    formula: '=IF(FALSE,1,"")',
    expectedValue: '',
  },
];

async function createTestDocument(): Promise<MogDocument> {
  return MogDocumentFactory.create({
    runtime: { kind: 'headless', userTimezone: 'UTC' },
  });
}

function dirtyCellFromChange(record: FormulaMetadataRecord) {
  return {
    sheet: record.sheet,
    address: record.address,
    oldValue: record.oldValue,
    value: record.newValue,
    formula: record.formula ?? null,
    changeType: record.origin === 'direct' ? 'direct' : 'indirect',
  };
}

describe('formula write mutation metadata', () => {
  let doc: MogDocument;
  let wb: Workbook;
  let ws: Worksheet;

  beforeEach(async () => {
    doc = await createTestDocument();
    wb = await doc.workbook();
    ws = wb.activeSheet;
  });

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it.each(cases)(
    'records direct asFormula write metadata as a formula for $label',
    async ({ address, input, formula, expectedValue }) => {
      const tracker = wb.changes.track({ origins: ['direct'] });

      await ws.setCell(address, input, { asFormula: true });

      const collected = await tracker.collectAsync();
      tracker.close();

      const metadata = collected.records.find(
        (record) => record.address === address,
      ) as FormulaMetadataRecord | undefined;
      const formulaText = await ws.getFormula(address);
      const finalCell = await ws.getCell(address);
      const dirtyCell = metadata ? dirtyCellFromChange(metadata) : undefined;

      expect(formulaText).toBe(formula);
      expect(finalCell.formula).toBe(formula);
      if (expectedValue !== undefined) {
        expect(finalCell.value).toEqual(expectedValue);
      }

      expect(metadata).toBeDefined();
      expect(metadata).toEqual(
        expect.objectContaining({
          address,
          origin: 'direct',
          type: 'modified',
          formula,
        }),
      );
      expect(dirtyCell).toEqual(
        expect.objectContaining({
          address,
          changeType: 'direct',
          formula,
        }),
      );
    },
  );
});
