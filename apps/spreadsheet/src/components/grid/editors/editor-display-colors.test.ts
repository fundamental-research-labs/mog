import { createResolvedSheetViewSkinForScheme } from '@mog-sdk/sheet-view';

import { resolveInlineEditorDisplayColors } from './editor-display-colors';

describe('resolveInlineEditorDisplayColors', () => {
  it('uses dark sheet skin defaults for automatic cell colors', () => {
    const darkSkin = createResolvedSheetViewSkinForScheme('dark');

    expect(resolveInlineEditorDisplayColors(undefined, darkSkin)).toEqual({
      backgroundColor: darkSkin.defaultCellBackground,
      textColor: darkSkin.defaultCellText,
    });
  });

  it('treats resolved default black as automatic text in dark mode', () => {
    const darkSkin = createResolvedSheetViewSkinForScheme('dark');

    for (const fontColor of ['#000000', '#000', 'rgb(0, 0, 0)']) {
      expect(resolveInlineEditorDisplayColors({ fontColor }, darkSkin).textColor).toBe(
        darkSkin.defaultCellText,
      );
    }
  });

  it('preserves explicit cell fill and font colors', () => {
    const darkSkin = createResolvedSheetViewSkinForScheme('dark');

    expect(
      resolveInlineEditorDisplayColors(
        { backgroundColor: '#abcdef', fontColor: '#123456' },
        darkSkin,
      ),
    ).toEqual({
      backgroundColor: '#abcdef',
      textColor: '#123456',
    });
  });
});
