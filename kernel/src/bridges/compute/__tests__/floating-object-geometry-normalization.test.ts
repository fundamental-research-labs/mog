import {
  floatingObjectGeometryTestHooks,
  normalizeFloatingObjectForStorage,
  normalizeFloatingObjectUpdateForStorage,
} from '../floating-object-geometry-normalization';

const { EMU_PER_PX } = floatingObjectGeometryTestHooks;

describe('floating object geometry normalization', () => {
  it('converts interaction-layer ObjectPosition pixels to persisted EMU anchor fields', () => {
    const normalized = normalizeFloatingObjectForStorage({
      id: 'picture-1',
      type: 'picture',
      sheetId: 'sheet-1',
      containerId: 'sheet-1',
      src: 'data:image/png;base64,abc',
      position: {
        anchorType: 'oneCell',
        from: { cellId: 'cell-4-3', xOffset: 7, yOffset: 5 },
        width: 88,
        height: 44,
        rotation: 15,
        flipH: true,
      },
      anchor: {
        anchorType: 'oneCell',
        from: { cellId: 'cell-4-3', xOffset: 7, yOffset: 5 },
        width: 88,
        height: 44,
      },
      zIndex: 2,
    }) as any;

    expect(normalized.position).toBeUndefined();
    expect(normalized.anchor).toEqual({
      anchorRow: 4,
      anchorCol: 3,
      anchorRowOffsetEmu: 5 * EMU_PER_PX,
      anchorColOffsetEmu: 7 * EMU_PER_PX,
      anchorMode: 'oneCell',
      extentCxEmu: 88 * EMU_PER_PX,
      extentCyEmu: 44 * EMU_PER_PX,
    });
    expect(normalized.anchorCellId).toBe('cell-4-3');
    expect(normalized.rotation).toBe(15);
    expect(normalized.flipH).toBe(true);
  });

  it('normalizes generic pixel offset update payloads instead of persisting ambiguous fields', () => {
    const normalized = normalizeFloatingObjectUpdateForStorage({
      anchorRow: 2,
      anchorCol: 1,
      xOffset: 6,
      yOffset: 9,
      width: 120,
      height: 80,
    }) as any;

    expect(normalized.xOffset).toBeUndefined();
    expect(normalized.yOffset).toBeUndefined();
    expect(normalized.anchorRow).toBeUndefined();
    expect(normalized.anchor).toEqual({
      anchorRow: 2,
      anchorCol: 1,
      anchorRowOffsetEmu: 9 * EMU_PER_PX,
      anchorColOffsetEmu: 6 * EMU_PER_PX,
      anchorMode: 'oneCell',
      extentCxEmu: 120 * EMU_PER_PX,
      extentCyEmu: 80 * EMU_PER_PX,
    });
    expect(normalized.width).toBe(120);
    expect(normalized.height).toBe(80);
  });

  it('keeps explicit EMU anchor values canonical and strips legacy aliases', () => {
    const normalized = normalizeFloatingObjectUpdateForStorage({
      anchor: {
        anchorRow: 1,
        anchorCol: 2,
        anchorRowOffset: 11 * EMU_PER_PX,
        anchorColOffset: 12 * EMU_PER_PX,
        extentCx: 300 * EMU_PER_PX,
        extentCy: 200 * EMU_PER_PX,
      },
    }) as any;

    expect(normalized.anchor).toEqual({
      anchorRow: 1,
      anchorCol: 2,
      anchorRowOffsetEmu: 11 * EMU_PER_PX,
      anchorColOffsetEmu: 12 * EMU_PER_PX,
      anchorMode: 'oneCell',
      extentCxEmu: 300 * EMU_PER_PX,
      extentCyEmu: 200 * EMU_PER_PX,
    });
  });

  it('preserves domain TextEffect config on the generated wire field', () => {
    const normalized = normalizeFloatingObjectForStorage({
      id: 'text-effect-1',
      type: 'textbox',
      sheetId: 'sheet-1',
      text: { content: 'Hello TextEffect' },
      textEffects: {
        warpPreset: 'textArchUp',
        fill: { type: 'solid', color: '#4472c4' },
      },
    }) as any;

    expect(normalized.textEffects).toEqual({
      warpPreset: 'textArchUp',
      fill: { type: 'solid', color: '#4472c4' },
    });
    expect(normalized.wordArt).toBeUndefined();
  });
});
