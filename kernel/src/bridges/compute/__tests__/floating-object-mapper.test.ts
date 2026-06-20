import type {
  FloatingObject as WireFloatingObject,
  SerializedFloatingObjectGroup,
} from '../compute-types.gen';

import {
  toFloatingObject,
  toFloatingObjectGroup,
  toObjectPosition,
  createMinimalFloatingObject,
} from '../floating-object-mapper';

const EMU_PER_PX = 9525;

// =============================================================================
// Helpers
// =============================================================================

/** Build a minimal wire object with overrides. */
function wireObject(overrides: Partial<WireFloatingObject> = {}): WireFloatingObject {
  return {
    id: 'obj-1',
    sheetId: 'sheet-1',
    type: 'shape',
    anchor: {
      anchorRow: 0,
      anchorCol: 0,
      anchorRowOffset: 0,
      anchorColOffset: 0,
      anchorMode: 'absolute',
    },
    width: 0,
    height: 0,
    zIndex: 0,
    rotation: 0,
    flipH: false,
    flipV: false,
    locked: false,
    visible: true,
    printable: true,
    opacity: 1,
    name: '',
    createdAt: 0,
    updatedAt: 0,
    shapeType: 'rect',
    ...overrides,
  } as WireFloatingObject;
}

/** Build a minimal wire group with overrides. */
function wireGroup(
  overrides: Partial<SerializedFloatingObjectGroup> = {},
): SerializedFloatingObjectGroup {
  return {
    id: 'group-1',
    sheetId: 'sheet-1',
    children: ['obj-1', 'obj-2'],
    extra: null,
    ...overrides,
  };
}

// =============================================================================
// toObjectPosition
// =============================================================================

describe('toObjectPosition', () => {
  it('builds an absolute position by default', () => {
    const pos = toObjectPosition(
      wireObject({
        anchor: {
          anchorRow: 0,
          anchorCol: 0,
          anchorRowOffset: 0,
          anchorColOffset: 0,
          anchorMode: 'absolute',
        },
        width: 100,
        height: 50,
      }),
    );
    expect(pos.anchorType).toBe('absolute');
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
    expect(pos.width).toBe(100);
    expect(pos.height).toBe(50);
    expect(pos.from.cellId).toBe('cell-0-0');
    expect(pos.from.xOffset).toBe(0);
    expect(pos.from.yOffset).toBe(0);
    expect(pos.to).toBeUndefined();
  });

  it('builds a oneCell position', () => {
    const pos = toObjectPosition(
      wireObject({
        anchor: {
          anchorMode: 'oneCell',
          anchorRow: 3,
          anchorCol: 2,
          anchorRowOffset: 10 * EMU_PER_PX,
          anchorColOffset: 5 * EMU_PER_PX,
        },
        width: 999,
        height: 999,
      }),
    );
    expect(pos.anchorType).toBe('oneCell');
    expect(pos.from.cellId).toBe('cell-3-2');
    expect(pos.from.xOffset).toBe(5);
    expect(pos.from.yOffset).toBe(10);
    expect(pos.width).toBe(999);
    expect(pos.height).toBe(999);
    expect(pos.to).toBeUndefined();
  });

  it('uses EMU extents as pixel size for oneCell wire anchors', () => {
    const pos = toObjectPosition(
      wireObject({
        anchor: {
          anchorMode: 'oneCell',
          anchorRow: 3,
          anchorCol: 2,
          anchorRowOffset: 0,
          anchorColOffset: 0,
          extentCx: 200 * EMU_PER_PX,
          extentCy: 150 * EMU_PER_PX,
        },
        width: 999,
        height: 999,
      }),
    );

    expect(pos.width).toBe(200);
    expect(pos.height).toBe(150);
  });

  it('prefers unit-explicit EMU anchor fields when present', () => {
    const pos = toObjectPosition(
      wireObject({
        anchor: {
          anchorMode: 'oneCell',
          anchorRow: 3,
          anchorCol: 2,
          anchorRowOffset: 999,
          anchorColOffset: 999,
          anchorRowOffsetEmu: 10 * EMU_PER_PX,
          anchorColOffsetEmu: 5 * EMU_PER_PX,
          extentCxEmu: 200 * EMU_PER_PX,
          extentCyEmu: 150 * EMU_PER_PX,
        },
        width: 999,
        height: 999,
      }),
    );

    expect(pos.from.xOffset).toBe(5);
    expect(pos.from.yOffset).toBe(10);
    expect(pos.width).toBe(200);
    expect(pos.height).toBe(150);
  });

  it('uses unit-explicit EMU twoCell end offsets when present', () => {
    const pos = toObjectPosition(
      wireObject({
        anchor: {
          anchorMode: 'twoCell',
          anchorRow: 1,
          anchorCol: 1,
          anchorRowOffset: 0,
          anchorColOffset: 0,
          endRow: 5,
          endCol: 4,
          endRowOffset: 999,
          endColOffset: 999,
          endRowOffsetEmu: 20 * EMU_PER_PX,
          endColOffsetEmu: 10 * EMU_PER_PX,
        },
      }),
    );

    expect(pos.to!.xOffset).toBe(10);
    expect(pos.to!.yOffset).toBe(20);
  });

  it('uses anchorCellId from wire data when available', () => {
    const pos = toObjectPosition(
      wireObject({
        anchor: {
          anchorMode: 'oneCell',
          anchorRow: 3,
          anchorCol: 2,
          anchorRowOffset: 10 * EMU_PER_PX,
          anchorColOffset: 5 * EMU_PER_PX,
        },
        anchorCellId: 'real-cell-id-abc',
      }),
    );
    expect(pos.from.cellId).toBe('real-cell-id-abc');
  });

  it('falls back to positional cellId when anchorCellId is missing', () => {
    const pos = toObjectPosition(
      wireObject({
        anchor: {
          anchorMode: 'oneCell',
          anchorRow: 3,
          anchorCol: 2,
          anchorRowOffset: 10 * EMU_PER_PX,
          anchorColOffset: 5 * EMU_PER_PX,
        },
      }),
    );
    expect(pos.from.cellId).toBe('cell-3-2');
  });

  it('builds a twoCell position with to anchor', () => {
    const pos = toObjectPosition(
      wireObject({
        anchor: {
          anchorMode: 'twoCell',
          anchorRow: 1,
          anchorCol: 1,
          anchorRowOffset: 0,
          anchorColOffset: 0,
          endRow: 5,
          endCol: 4,
          endRowOffset: 20 * EMU_PER_PX,
          endColOffset: 10 * EMU_PER_PX,
        },
        anchorCellId: 'from-cell',
        toAnchorCellId: 'to-cell',
      }),
    );
    expect(pos.anchorType).toBe('twoCell');
    expect(pos.from.cellId).toBe('from-cell');
    expect(pos.to).toBeDefined();
    expect(pos.to!.cellId).toBe('to-cell');
    expect(pos.to!.xOffset).toBe(10);
    expect(pos.to!.yOffset).toBe(20);
  });

  it('includes rotation and flip flags', () => {
    const pos = toObjectPosition(wireObject({ rotation: 45, flipH: true, flipV: false }));
    expect(pos.rotation).toBe(45);
    expect(pos.flipH).toBe(true);
    expect(pos.flipV).toBe(false);
  });

  it('works with SerializedFloatingObjectGroup', () => {
    const pos = toObjectPosition(wireGroup({ x: 50, y: 60, width: 300, height: 200 }));
    expect(pos.anchorType).toBe('absolute');
    expect(pos.x).toBe(50);
    expect(pos.y).toBe(60);
    expect(pos.width).toBe(300);
    expect(pos.height).toBe(200);
  });
});

// =============================================================================
// toFloatingObject — Shape
// =============================================================================

describe('toFloatingObject — ShapeObject', () => {
  it('maps a shape with full fields', () => {
    const obj = toFloatingObject(
      wireObject({
        type: 'shape',
        shapeType: 'roundRect',
        width: 100,
        height: 50,
        zIndex: 3,
        locked: true,
        printable: false,
        name: 'My Shape',
        fill: { type: 'solid', color: '#ff0000' },
        outline: { style: 'solid', color: '#000000', width: 2 },
        text: { content: 'Hello', verticalAlign: 'middle' },
        adjustments: { cornerRadius: 10 },
      } as Partial<WireFloatingObject>),
    );
    expect(obj.type).toBe('shape');
    expect(obj.id).toBe('obj-1');
    expect(obj.sheetId).toBe('sheet-1');
    expect(obj.containerId).toBe('sheet-1');
    expect(obj.zIndex).toBe(3);
    expect(obj.locked).toBe(true);
    expect(obj.printable).toBe(false);
    expect(obj.name).toBe('My Shape');
    expect(obj.position).toBe(obj.anchor); // same reference

    if (obj.type === 'shape') {
      expect(obj.shapeType).toBe('roundRect');
      expect(obj.fill).toEqual({ type: 'solid', color: '#ff0000' });
      expect(obj.outline).toEqual({ style: 'solid', color: '#000000', width: 2 });
      expect(obj.text).toEqual({ content: 'Hello', verticalAlign: 'middle' });
      expect(obj.adjustments).toEqual({ cornerRadius: 10 });
    }
  });

  it('defaults to shape for missing type', () => {
    const obj = toFloatingObject(wireObject({}));
    expect(obj.type).toBe('shape');
  });

  it('defaults to shape for unknown type', () => {
    const obj = toFloatingObject(wireObject({ type: 'slicer' } as Partial<WireFloatingObject>));
    expect(obj.type).toBe('shape');
  });

  it('defaults shapeType to rect when not specified', () => {
    const obj = toFloatingObject(wireObject({ type: 'shape' }));
    if (obj.type === 'shape') {
      expect(obj.shapeType).toBe('rect');
    }
  });
});

// =============================================================================
// toFloatingObject — Picture
// =============================================================================

describe('toFloatingObject — PictureObject', () => {
  it('maps a picture with required and optional fields', () => {
    const obj = toFloatingObject(
      wireObject({
        type: 'picture',
        width: 400,
        height: 300,
        src: 'data:image/png;base64,abc123',
        originalWidth: 800,
        originalHeight: 600,
        crop: { top: 1, right: 2, bottom: 3, left: 4 },
        adjustments: { brightness: 10, contrast: -5, transparency: 25 },
        border: { style: 'dotted', color: '#123456', width: 2 },
        colorType: 'grayScale',
      } as Partial<WireFloatingObject>),
    );
    expect(obj.type).toBe('picture');
    if (obj.type === 'picture') {
      expect(obj.src).toBe('data:image/png;base64,abc123');
      expect(obj.originalWidth).toBe(800);
      expect(obj.originalHeight).toBe(600);
      expect(obj.crop).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
      expect(obj.adjustments).toEqual({ brightness: 10, contrast: -5, transparency: 25 });
      expect(obj.border).toEqual({ style: 'dotted', color: '#123456', width: 2 });
      expect(obj.colorType).toBe('grayScale');
    }
  });

  it('defaults src to empty string when missing', () => {
    const obj = toFloatingObject(wireObject({ type: 'picture' } as Partial<WireFloatingObject>));
    if (obj.type === 'picture') {
      expect(obj.src).toBe('');
      expect(obj.originalWidth).toBe(0);
      expect(obj.originalHeight).toBe(0);
    }
  });
});

// =============================================================================
// toFloatingObject — Connector
// =============================================================================

describe('toFloatingObject — ConnectorObject', () => {
  it('maps a connector with connections', () => {
    const obj = toFloatingObject(
      wireObject({
        type: 'connector',
        shapeType: 'bentConnector3',
        startConnection: { shapeId: 'shape-a', siteIndex: 2 },
        endConnection: { shapeId: 'shape-b', siteIndex: 0 },
        outline: { style: 'solid', color: '#333', width: 1 },
      } as Partial<WireFloatingObject>),
    );
    expect(obj.type).toBe('connector');
    if (obj.type === 'connector') {
      expect(obj.shapeType).toBe('bentConnector3');
      expect(obj.startConnection).toEqual({ shapeId: 'shape-a', siteIndex: 2 });
      expect(obj.endConnection).toEqual({ shapeId: 'shape-b', siteIndex: 0 });
      expect(obj.outline).toEqual({ style: 'solid', color: '#333', width: 1 });
    }
  });

  it('defaults shapeType to connector when not specified', () => {
    const obj = toFloatingObject(
      wireObject({ type: 'connector', shapeType: undefined } as Partial<WireFloatingObject>),
    );
    if (obj.type === 'connector') {
      expect(obj.shapeType).toBe('connector');
    }
  });
});

// =============================================================================
// toFloatingObject — TextBox
// =============================================================================

describe('toFloatingObject — TextBoxObject', () => {
  it('maps a textbox with content', () => {
    const obj = toFloatingObject(
      wireObject({
        type: 'textbox',
        text: { content: 'Hello World' },
      } as Partial<WireFloatingObject>),
    );
    expect(obj.type).toBe('textbox');
    if (obj.type === 'textbox') {
      expect(obj.text?.content).toBe('Hello World');
    }
  });

  it('defaults content to empty string when content is present', () => {
    const obj = toFloatingObject(
      wireObject({ type: 'textbox', text: { content: '' } } as Partial<WireFloatingObject>),
    );
    if (obj.type === 'textbox') {
      expect(obj.text?.content).toBe('');
    }
  });

  it('maps textbox text effects', () => {
    const obj = toFloatingObject(
      wireObject({
        type: 'textbox',
        text: { content: 'Hello TextEffect' },
        textEffects: {
          warpPreset: 'textArchUp',
          fill: { type: 'solid', color: '#4472c4' },
        },
      } as Partial<WireFloatingObject>),
    );

    expect(obj.type).toBe('textbox');
    if (obj.type === 'textbox') {
      expect(obj.textEffects).toEqual({
        warpPreset: 'textArchUp',
        fill: { type: 'solid', color: '#4472c4' },
      });
    }
  });

  it('maps persisted Rust wordArt textbox compatibility field to textEffects', () => {
    const obj = toFloatingObject(
      wireObject({
        type: 'textbox',
        text: { content: 'Hello TextEffect' },
        wordArt: {
          warpPreset: 'textArchUp',
          fill: { type: 'solid', color: '#4472c4' },
        },
      } as Partial<WireFloatingObject> & { wordArt: unknown }),
    );

    expect(obj.type).toBe('textbox');
    if (obj.type === 'textbox') {
      expect(obj.textEffects).toEqual({
        warpPreset: 'textArchUp',
        fill: { type: 'solid', color: '#4472c4' },
      });
    }
  });
});

// =============================================================================
// toFloatingObject — Chart
// =============================================================================

describe('toFloatingObject — ChartObject', () => {
  it('maps a chart with type and chart config', () => {
    const obj = toFloatingObject(
      wireObject({
        type: 'chart',
        anchor: {
          anchorRow: 0,
          anchorCol: 0,
          anchorRowOffset: 0,
          anchorColOffset: 0,
          anchorMode: 'oneCell',
        },
        chartType: 'bar',
        width: 640,
        height: 300,
        widthCells: 4,
        heightCells: 5,
      } as Partial<WireFloatingObject>),
    );
    expect(obj.type).toBe('chart');
    if (obj.type === 'chart') {
      expect(obj.chartType).toBe('bar');
      expect(obj.anchorMode).toBe('oneCell');
      expect(obj.widthCells).toBe(8);
      expect(obj.heightCells).toBe(15);
    }
  });

  it('preserves imported chart spacing and hidden-data settings in chartConfig', () => {
    const obj = toFloatingObject(
      wireObject({
        type: 'chart',
        chartType: 'column',
        gapWidth: 150,
        overlap: 100,
        plotVisibleOnly: true,
        plotLayout: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 },
        titleLayout: { x: 0.2, y: 0.05 },
        dataTable: { visible: true, showKeys: true },
        pivotOptions: { showAxisFieldButtons: false },
        showAllFieldButtons: true,
        view3d: { rotX: 30, rotY: 20 },
        sideWallFormat: { fill: { type: 'solid', color: '#dddddd' } },
      } as Partial<WireFloatingObject>),
    );

    expect(obj.type).toBe('chart');
    if (obj.type === 'chart') {
      expect(obj.chartConfig).toEqual(
        expect.objectContaining({
          gapWidth: 150,
          overlap: 100,
          plotVisibleOnly: true,
          plotLayout: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 },
          titleLayout: { x: 0.2, y: 0.05 },
          dataTable: { visible: true, showKeys: true },
          pivotOptions: { showAxisFieldButtons: false },
          showAllFieldButtons: true,
          view3d: { rotX: 30, rotY: 20 },
          sideWallFormat: { fill: { type: 'solid', color: '#dddddd' } },
        }),
      );
    }
  });

  it('preserves imported modern chart family configs in chartConfig', () => {
    const obj = toFloatingObject(
      wireObject({
        type: 'chart',
        chartType: 'histogram',
        waterfall: { subtotalIndices: [2], showConnectorLines: false },
        histogram: { binCount: 8, overflowBin: true, overflowBinValue: 100 },
        boxplot: {
          showOutlierPoints: false,
          showMeanMarkers: true,
          quartileMethod: 'exclusive',
        },
        hierarchy: {
          categoryFormulas: ['Sheet1!A1:A3'],
          valueFormula: 'Sheet1!B1:B3',
          rows: [{ id: 'A', label: 'A', level: 0, value: 3 }],
          parentLabelLayout: 'banner',
        },
        regionMap: {
          regionFormula: 'Sheet1!A1:A3',
          valueFormula: 'Sheet1!B1:B3',
        },
      } as Partial<WireFloatingObject>),
    );

    expect(obj.type).toBe('chart');
    if (obj.type === 'chart') {
      expect(obj.chartConfig).toEqual(
        expect.objectContaining({
          waterfall: { subtotalIndices: [2], showConnectorLines: false },
          histogram: { binCount: 8, overflowBin: true, overflowBinValue: 100 },
          boxplot: {
            showOutlierPoints: false,
            showMeanMarkers: true,
            quartileMethod: 'exclusive',
          },
          hierarchy: expect.objectContaining({
            categoryFormulas: ['Sheet1!A1:A3'],
            valueFormula: 'Sheet1!B1:B3',
            parentLabelLayout: 'banner',
          }),
          regionMap: {
            regionFormula: 'Sheet1!A1:A3',
            valueFormula: 'Sheet1!B1:B3',
          },
        }),
      );
    }
  });

  it('preserves imported chart status and does not default missing imported type to column', () => {
    const importStatus = {
      source: 'xlsx',
      featureKind: 'chart',
      recoverability: 'preservedNotRenderable',
      renderability: 'notRenderable',
      editability: 'partiallyEditable',
      diagnostics: [],
    } as const;
    const obj = toFloatingObject(
      wireObject({
        type: 'chart',
        chartType: '',
        importStatus,
      } as Partial<WireFloatingObject>),
    );

    expect(obj.type).toBe('chart');
    if (obj.type === 'chart') {
      expect(obj.importStatus).toBe(importStatus);
      expect(obj.chartType).toBe('');
    }
  });
});

// =============================================================================
// toFloatingObject — Equation
// =============================================================================

describe('toFloatingObject — EquationObject', () => {
  it('maps an equation with pass-through data', () => {
    const equationData = { latex: 'x^2', style: { fontSize: 18 } };
    const obj = toFloatingObject(
      wireObject({
        type: 'equation',
        equation: equationData as unknown as string,
      } as Partial<WireFloatingObject>),
    );
    expect(obj.type).toBe('equation');
    if (obj.type === 'equation') {
      expect(obj.equation).toEqual(
        expect.objectContaining({
          latex: 'x^2',
          omml: '',
          style: expect.objectContaining({
            fontFamily: 'Cambria Math',
            fontSize: 18,
            color: '#000000',
          }),
        }),
      );
    }
  });

  it('wraps string equation wire data into a renderable domain equation', () => {
    const obj = toFloatingObject(
      wireObject({
        id: 'eq-1',
        type: 'equation',
        equation: '\\frac{a}{b}',
      } as Partial<WireFloatingObject>),
    );
    expect(obj.type).toBe('equation');
    if (obj.type === 'equation') {
      expect(obj.equation).toEqual(
        expect.objectContaining({
          id: 'eq-1',
          latex: '\\frac{a}{b}',
          omml: '',
          style: expect.objectContaining({
            fontFamily: 'Cambria Math',
            fontSize: 11,
            color: '#000000',
          }),
        }),
      );
    }
  });
});

// =============================================================================
// toFloatingObjectGroup
// =============================================================================

describe('toFloatingObjectGroup', () => {
  it('maps a group with children and position', () => {
    const group = toFloatingObjectGroup(
      wireGroup({
        id: 'grp-1',
        sheetId: 'sheet-2',
        children: ['a', 'b', 'c'],
        x: 10,
        y: 20,
        width: 300,
        height: 200,
        zIndex: 5,
        name: 'Group A',
        locked: true,
      }),
    );
    expect(group.id).toBe('grp-1');
    expect(group.sheetId).toBe('sheet-2');
    expect(group.containerId).toBe('sheet-2');
    expect(group.memberIds).toEqual(['a', 'b', 'c']);
    expect(group.zIndex).toBe(5);
    expect(group.name).toBe('Group A');
    expect(group.locked).toBe(true);
    expect(group.position.x).toBe(10);
    expect(group.position.y).toBe(20);
    expect(group.position.width).toBe(300);
    expect(group.position.height).toBe(200);
  });

  it('defaults zIndex and locked', () => {
    const group = toFloatingObjectGroup(wireGroup({}));
    expect(group.zIndex).toBe(0);
    expect(group.locked).toBe(false);
  });

  it('uses positional cellId by default', () => {
    const group = toFloatingObjectGroup(wireGroup({}));
    expect(group.position.anchorType).toBe('absolute');
  });
});

// =============================================================================
// createMinimalFloatingObject
// =============================================================================

describe('createMinimalFloatingObject', () => {
  it('creates a minimal shape', () => {
    const obj = createMinimalFloatingObject('shape', 'new-1', 'sheet-1');
    expect(obj.type).toBe('shape');
    expect(obj.id).toBe('new-1');
    expect(obj.sheetId).toBe('sheet-1');
    expect(obj.containerId).toBe('sheet-1');
    expect(obj.zIndex).toBe(0);
    expect(obj.locked).toBe(false);
    expect(obj.printable).toBe(true);
    expect(obj.position.x).toBe(0);
    expect(obj.position.y).toBe(0);
    expect(obj.position.width).toBe(100);
    expect(obj.position.height).toBe(100);
  });

  it('creates a minimal picture', () => {
    const obj = createMinimalFloatingObject('picture', 'pic-1', 'sheet-1');
    expect(obj.type).toBe('picture');
    if (obj.type === 'picture') {
      expect(obj.src).toBe('');
      expect(obj.originalWidth).toBe(0);
      expect(obj.originalHeight).toBe(0);
    }
  });

  it('applies extras', () => {
    const obj = createMinimalFloatingObject('shape', 'ex-1', 'sheet-1', {
      width: 200,
      height: 150,
      zIndex: 10,
      name: 'Custom',
    });
    expect(obj.position.width).toBe(200);
    expect(obj.position.height).toBe(150);
    expect(obj.zIndex).toBe(10);
    expect(obj.name).toBe('Custom');
  });
});

// =============================================================================
// Default values
// =============================================================================

describe('default values', () => {
  it('defaults locked to false', () => {
    const obj = toFloatingObject(wireObject({ type: 'shape' }));
    expect(obj.locked).toBe(false);
  });

  it('defaults printable to true', () => {
    const obj = toFloatingObject(wireObject({ type: 'shape' }));
    expect(obj.printable).toBe(true);
  });

  it('defaults zIndex to 0', () => {
    const obj = toFloatingObject(wireObject({ type: 'shape' }));
    expect(obj.zIndex).toBe(0);
  });

  it('defaults anchorType to absolute', () => {
    const obj = toFloatingObject(wireObject({ type: 'shape' }));
    expect(obj.position.anchorType).toBe('absolute');
  });

  it('position and anchor are the same reference', () => {
    const obj = toFloatingObject(wireObject({ type: 'shape' }));
    expect(obj.position).toBe(obj.anchor);
  });
});
