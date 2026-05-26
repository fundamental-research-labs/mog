import type { SheetViewSkinEvent } from '../public-types';
import {
  createResolvedSheetViewSkinForScheme,
  resolveSheetViewSkin,
  SheetViewSkinCapability,
} from '../capabilities/skin';

describe('SheetViewSkinCapability', () => {
  function makeCapability(invalidate = jest.fn(), updateResolvedSkin = jest.fn()) {
    return new SheetViewSkinCapability({ invalidate, updateResolvedSkin });
  }

  it('stores the current skin and invalidates rendering on set', () => {
    const invalidate = jest.fn();
    const updateResolvedSkin = jest.fn();
    const skinCapability = makeCapability(invalidate, updateResolvedSkin);
    const skin = {
      gridlines: {
        kind: 'styled',
        color: '#123456',
        dash: [4, 2],
      },
    } as const;

    skinCapability.set(skin);

    expect(skinCapability.get()).toBe(skin);
    expect(skinCapability.getResolved()).toEqual({
      skin,
      status: 'ready',
      validationErrors: [],
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(updateResolvedSkin).toHaveBeenCalledTimes(1);
  });

  it('emits change events and stops after subscription dispose', () => {
    const skinCapability = makeCapability();
    const received: SheetViewSkinEvent[] = [];
    const sub = skinCapability.on((event) => received.push(event));

    skinCapability.set({ background: { kind: 'transparent' } });
    sub.dispose();
    skinCapability.set(null);

    expect(received).toEqual([{ type: 'change', skin: { background: { kind: 'transparent' } } }]);
  });

  it('clears state and subscribers on dispose', () => {
    const skinCapability = makeCapability();
    const received: SheetViewSkinEvent[] = [];
    skinCapability.set({ background: { kind: 'color', color: '#fff' } });
    skinCapability.on((event) => received.push(event));

    skinCapability.dispose();
    skinCapability.set({ background: { kind: 'transparent' } });

    expect(skinCapability.get()).toEqual({ background: { kind: 'transparent' } });
    expect(received).toHaveLength(0);
  });
});

describe('resolveSheetViewSkin', () => {
  it('uses public chrome theme tokens as defaults and explicit skin as renderer policy', () => {
    const resolved = resolveSheetViewSkin({
      chromeTheme: {
        background: '#101820',
        gridlineColor: '#d4af37',
        selectionBorder: '#ffcc00',
      },
      skin: {
        id: 'ledger',
        background: { kind: 'color', color: { kind: 'theme-token', token: 'canvasBackground' } },
        gridlines: {
          kind: 'styled',
          color: { kind: 'theme-token', token: 'gridlineColor' },
          style: 'dashed',
          majorEveryRows: 5,
        },
        selection: {
          border: { kind: 'theme-token', token: 'selectionBorder' },
        },
      },
    });

    expect(resolved.skinId).toBe('ledger');
    expect(resolved.background).toMatchObject({ kind: 'color', color: '#101820' });
    expect(resolved.gridlines).toMatchObject({
      kind: 'solid',
      color: '#d4af37',
      dash: [4, 4],
      majorEveryRows: 5,
    });
    expect(resolved.selection.border).toBe('#ffcc00');
  });

  it('resolves default skin without mutating workbook-facing inputs', () => {
    const skin = { background: { kind: 'transparent' } } as const;
    const resolved = resolveSheetViewSkin({ skin });

    expect(skin).toEqual({ background: { kind: 'transparent' } });
    expect(resolved.background.kind).toBe('transparent');
  });

  it('resolves dark display defaults for no-fill cells and automatic text', () => {
    const resolved = createResolvedSheetViewSkinForScheme('dark');

    expect(resolved.colorScheme).toBe('dark');
    expect(resolved.defaultCellBackground).not.toBe('#ffffff');
    expect(resolved.defaultCellText).not.toBe('#000000');
    expect(resolved.controls.validationDropdown).toContain('244');
  });

  it('preserves host-provided custom cell and overlay tokens', () => {
    const resolved = resolveSheetViewSkin({
      colorScheme: 'dark',
      skin: {
        id: 'custom-dark',
        defaultCellBackground: '#010203',
        defaultCellText: '#fefefe',
        controls: { checkboxBorder: '#abcdef' },
        overlays: { searchHighlightBorder: '#fedcba' },
      },
    });

    expect(resolved.defaultCellBackground).toBe('#010203');
    expect(resolved.defaultCellText).toBe('#fefefe');
    expect(resolved.controls.checkboxBorder).toBe('#abcdef');
    expect(resolved.overlays.searchHighlightBorder).toBe('#fedcba');
  });
});
