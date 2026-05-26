/**
 * Last-used selection slice tests.
 *
 * Lock the slice contract for `lastUsed*` fields independently of
 * app-eval (the slowest gate). The handler-side recording and the
 * FontGroup replay path both rely on these setters round-tripping;
 * if they ever drift, this test fails before the user-visible scenario.
 */

import { create } from 'zustand';

import { createBordersPickerSlice, type BordersPickerSlice } from '../borders-picker';
import { createFillColorPickerSlice, type FillColorPickerSlice } from '../fill-color-picker';
import { createFontColorPickerSlice, type FontColorPickerSlice } from '../font-color-picker';

describe('FontColorPickerSlice — last-used', () => {
  it('initializes lastUsedFontColor to null and round-trips a setter call', () => {
    const store = create<FontColorPickerSlice>()(createFontColorPickerSlice);
    expect(store.getState().lastUsedFontColor).toBeNull();
    store.getState().setLastUsedFontColor('#FF0000');
    expect(store.getState().lastUsedFontColor).toBe('#FF0000');
    store.getState().setLastUsedFontColor('#00FF00');
    expect(store.getState().lastUsedFontColor).toBe('#00FF00');
  });
});

describe('FillColorPickerSlice — last-used', () => {
  it('initializes lastUsedFillColor to null and round-trips a setter call', () => {
    const store = create<FillColorPickerSlice>()(createFillColorPickerSlice);
    expect(store.getState().lastUsedFillColor).toBeNull();
    store.getState().setLastUsedFillColor('#FFFF00');
    expect(store.getState().lastUsedFillColor).toBe('#FFFF00');
    store.getState().setLastUsedFillColor('#0000FF');
    expect(store.getState().lastUsedFillColor).toBe('#0000FF');
  });
});

describe('BordersPickerSlice — last-used', () => {
  it('initializes lastUsedBorderFormat to null and round-trips a setter call', () => {
    const store = create<BordersPickerSlice>()(createBordersPickerSlice);
    expect(store.getState().lastUsedBorderFormat).toBeNull();

    const outline = {
      borders: {
        top: { style: 'thin' as const, color: '#000000' },
        right: { style: 'thin' as const, color: '#000000' },
        bottom: { style: 'thin' as const, color: '#000000' },
        left: { style: 'thin' as const, color: '#000000' },
      },
      preset: 'outline' as const,
    };
    store.getState().setLastUsedBorderFormat(outline);
    expect(store.getState().lastUsedBorderFormat).toEqual(outline);

    // "No Border" is a valid recorded selection (preset 'none' with the
    // shape `convertBorderSide(null)` actually emits — not an empty object).
    const noBorder = {
      borders: {
        top: { style: 'none' as const },
        right: { style: 'none' as const },
        bottom: { style: 'none' as const },
        left: { style: 'none' as const },
      },
      preset: 'none' as const,
    };
    store.getState().setLastUsedBorderFormat(noBorder);
    expect(store.getState().lastUsedBorderFormat).toEqual(noBorder);
  });
});
