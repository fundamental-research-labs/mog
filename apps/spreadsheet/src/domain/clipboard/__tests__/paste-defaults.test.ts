import { createDefaultPasteOptions } from '../paste-executor';
import {
  hasUsableExternalFormatPayload,
  resolveDefaultPasteOptions,
  shouldNoopExternalFormatsPaste,
} from '../paste-defaults';

const basePreference = {
  version: 1 as const,
  defaultPasteType: 'all' as const,
  skipBlanks: false,
  transpose: false,
};

describe('resolveDefaultPasteOptions', () => {
  it('maps all supported V1 paste types and preserves legacy defaults', () => {
    const cases = [
      ['all', {}],
      ['values', { values: true }],
      ['formulas', { formulas: true }],
      ['formats', { formats: true }],
    ] as const;

    for (const [defaultPasteType, expected] of cases) {
      const resolved = resolveDefaultPasteOptions(
        { ...basePreference, defaultPasteType, skipBlanks: true, transpose: true },
        { sourceKind: 'internal-copy', hasInternalRichData: true },
      );

      expect(resolved.appliesDefault).toBe(true);
      expect(resolved.reason).toBe('normal-default');
      expect(resolved.options).toEqual({
        ...createDefaultPasteOptions(),
        ...expected,
        skipBlanks: true,
        transpose: true,
      });
      expect(resolved.options.skipHiddenRows).toBe(true);
    }
  });

  it('preserves cut move and image paste semantics', () => {
    expect(
      resolveDefaultPasteOptions(
        { ...basePreference, defaultPasteType: 'values' },
        { sourceKind: 'internal-cut', hasInternalRichData: true },
      ),
    ).toMatchObject({
      appliesDefault: false,
      reason: 'cut-move-preserved',
      options: createDefaultPasteOptions(),
    });

    expect(
      resolveDefaultPasteOptions(
        { ...basePreference, defaultPasteType: 'values' },
        { sourceKind: 'external-image' },
      ),
    ).toMatchObject({
      appliesDefault: false,
      reason: 'image-paste-unaffected',
      options: createDefaultPasteOptions(),
    });
  });

  it('fails closed for invalid preferences and impossible contexts', () => {
    expect(
      resolveDefaultPasteOptions(
        { version: 1, defaultPasteType: 'comments', skipBlanks: false, transpose: false },
        { sourceKind: 'external-text', hasExternalText: true },
      ),
    ).toMatchObject({
      appliesDefault: false,
      reason: 'invalid-preference-fallback',
      options: createDefaultPasteOptions(),
    });

    expect(
      resolveDefaultPasteOptions(basePreference, {
        sourceKind: 'external-text',
        hasInternalRichData: true,
      }),
    ).toMatchObject({
      appliesDefault: false,
      reason: 'unsupported-source-fallback',
      options: createDefaultPasteOptions(),
    });
  });
});

describe('external formats no-op guard', () => {
  it('detects usable HTML formats and plain text no-op cases', () => {
    expect(
      hasUsableExternalFormatPayload(
        '<table><tr><td style="font-weight: bold">A</td></tr></table>',
      ),
    ).toBe(true);
    expect(hasUsableExternalFormatPayload('<table><tr><td>A</td></tr></table>')).toBe(false);
    expect(shouldNoopExternalFormatsPaste({ formats: true })).toBe(true);
    expect(
      shouldNoopExternalFormatsPaste(
        { formats: true },
        '<table><tr><td style="background-color: #ff0000">A</td></tr></table>',
      ),
    ).toBe(false);
    expect(shouldNoopExternalFormatsPaste({ values: true, formats: true })).toBe(false);
  });
});
