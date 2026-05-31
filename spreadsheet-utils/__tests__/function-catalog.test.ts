import { FunctionCategory } from '@mog-sdk/contracts/utils/function-registry';
import { ensureFunctionCatalog } from '@mog/spreadsheet-utils/function-catalog';
import { globalRegistry } from '@mog/spreadsheet-utils/function-registry';

describe('function catalog', () => {
  it('exposes round 74 text functions through the global registry', () => {
    ensureFunctionCatalog();

    const expected = [
      ['BAHTTEXT', 1, 1],
      ['ENCODEURL', 1, 1],
      ['JOIN', 2, Infinity],
      ['SPLIT', 2, 4],
    ] as const;

    for (const [name, minArgs, maxArgs] of expected) {
      const metadata = globalRegistry.getMetadata(name);
      expect(metadata).toMatchObject({
        name,
        category: FunctionCategory.TEXT,
        minArgs,
        maxArgs,
      });
    }
  });

  it('exposes round 74 Sheets type conversion functions through the global registry', () => {
    ensureFunctionCatalog();

    const expected = [
      [
        'EPOCHTODATE',
        FunctionCategory.DATE_TIME,
        'Converts a Unix epoch timestamp to a UTC date-time serial',
        1,
        2,
      ],
      ['TO_DATE', FunctionCategory.TEXT, 'Converts a number to a date value', 1, 1],
      ['TO_DOLLARS', FunctionCategory.TEXT, 'Converts a number to a dollar value', 1, 1],
      ['TO_PERCENT', FunctionCategory.TEXT, 'Converts a number to a percentage value', 1, 1],
      [
        'TO_PURE_NUMBER',
        FunctionCategory.TEXT,
        'Removes numeric formatting interpretation from a value',
        1,
        1,
      ],
      ['TO_TEXT', FunctionCategory.TEXT, 'Converts a numeric value to text', 1, 1],
    ] as const;

    for (const [name, category, description, minArgs, maxArgs] of expected) {
      const metadata = globalRegistry.getMetadata(name);
      expect(metadata).toMatchObject({
        name,
        category,
        description,
        minArgs,
        maxArgs,
      });
    }
  });

  it('exposes SUM argument labels for formula hints', () => {
    ensureFunctionCatalog();

    expect(globalRegistry.getMetadata('SUM')?.arguments).toEqual([
      expect.objectContaining({
        name: 'number1',
        optional: false,
      }),
      expect.objectContaining({
        name: 'number2',
        optional: true,
        repeating: true,
      }),
    ]);
  });
});
