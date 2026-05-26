/**
 * Handle Implementation Unit Tests
 *
 * Tests the floating object handle hierarchy:
 * 1. Base handle: type narrowing (is*() / as*() correctness)
 * 2. Delegation: hosting ops delegate to WorksheetObjectsImpl
 * 3. Covariant duplicate(): subclass handles return their own type
 * 4. Reads: getBounds() with and without boundsReader
 * 5. Subclass-specific operations
 */
import { jest } from '@jest/globals';

import { KernelError } from '../../../../errors';
import { FloatingObjectHandleImpl } from '../floating-object-handle-impl';
import { ShapeHandleImpl } from '../shape-handle-impl';
import { PictureHandleImpl } from '../picture-handle-impl';
import { DrawingHandleImpl } from '../drawing-handle-impl';
import { ChartHandleImpl } from '../chart-handle-impl';
import { TextEffectHandleImpl } from '../text-effects-handle-impl';
import { TextBoxHandleImpl } from '../textbox-handle-impl';
import { createFloatingObjectHandle } from '../floating-object-handle-factory';
import type { WorksheetObjectsImpl } from '../../objects';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function createMockObjectsImpl(): jest.Mocked<WorksheetObjectsImpl> {
  const receipt = {
    domain: 'floatingObject' as const,
    action: 'update' as const,
    id: 'dup-1',
    object: {},
    bounds: { x: 0, y: 0, width: 100, height: 50, rotation: 0 },
  };

  return {
    move: jest.fn().mockResolvedValue(receipt),
    resize: jest.fn().mockResolvedValue(receipt),
    rotate: jest.fn().mockResolvedValue(undefined),
    flip: jest.fn().mockResolvedValue(undefined),
    bringToFront: jest.fn().mockResolvedValue(undefined),
    sendToBack: jest.fn().mockResolvedValue(undefined),
    bringForward: jest.fn().mockResolvedValue(undefined),
    sendBackward: jest.fn().mockResolvedValue(undefined),
    remove: jest
      .fn()
      .mockResolvedValue({ domain: 'floatingObject', action: 'remove', id: 'test-1' }),
    duplicate: jest.fn().mockResolvedValue({ ...receipt, id: 'dup-1' }),
    get: jest.fn().mockResolvedValue({ id: 'test-1', type: 'shape' }),
    getFullObject: jest.fn().mockResolvedValue({ id: 'test-1', type: 'shape' }),
    update: jest.fn().mockResolvedValue(undefined),
    updateShape: jest.fn().mockResolvedValue(receipt),
    getShape: jest.fn().mockResolvedValue({ id: 'shape-1', shapeType: 'rect' }),
    updatePicture: jest.fn().mockResolvedValue(undefined),
    updateTextEffect: jest.fn().mockResolvedValue(undefined),
    addDrawingStroke: jest.fn().mockResolvedValue(undefined),
    eraseDrawingStrokes: jest.fn().mockResolvedValue(undefined),
    clearDrawingStrokes: jest.fn().mockResolvedValue(undefined),
    moveDrawingStrokes: jest.fn().mockResolvedValue(undefined),
    transformDrawingStrokes: jest.fn().mockResolvedValue(undefined),
    findStrokesAtPoint: jest.fn().mockResolvedValue([]),
    getDrawing: jest.fn().mockResolvedValue({ id: 'draw-1', strokes: [] }),
  } as unknown as jest.Mocked<WorksheetObjectsImpl>;
}

function createMockBoundsReader(
  bounds: Record<string, unknown> | null = null,
): IObjectBoundsReader {
  return {
    getBounds: jest.fn().mockReturnValue(bounds),
    getGroupBounds: jest.fn().mockReturnValue(null),
    getBoundsMany: jest.fn().mockReturnValue([]),
  } as unknown as IObjectBoundsReader;
}

// ---------------------------------------------------------------------------
// FloatingObjectHandleImpl (base)
// ---------------------------------------------------------------------------

describe('FloatingObjectHandleImpl', () => {
  let mockObjects: jest.Mocked<WorksheetObjectsImpl>;
  let handle: FloatingObjectHandleImpl;

  beforeEach(() => {
    mockObjects = createMockObjectsImpl();
    handle = new FloatingObjectHandleImpl('test-1', 'shape', mockObjects, null);
  });

  // -- Type narrowing -------------------------------------------------------

  describe('type narrowing — is*()', () => {
    it('isShape() returns true for shape type', () => {
      expect(handle.isShape()).toBe(true);
    });

    it('isPicture() returns false for shape type', () => {
      expect(handle.isPicture()).toBe(false);
    });

    it('isChart() returns false for shape type', () => {
      expect(handle.isChart()).toBe(false);
    });

    it('isTextBox() returns false for shape type', () => {
      expect(handle.isTextBox()).toBe(false);
    });

    it('isDrawing() returns false for shape type', () => {
      expect(handle.isDrawing()).toBe(false);
    });

    it('isTextEffect() always returns false on base handle', () => {
      // Base class hard-codes isTextEffect() → false because TextEffect is a
      // special textbox and only TextEffectHandleImpl overrides to true.
      const textboxHandle = new FloatingObjectHandleImpl('tb-1', 'textbox', mockObjects, null);
      expect(textboxHandle.isTextEffect()).toBe(false);
    });
  });

  describe('type narrowing — as*()', () => {
    it('asShape() returns handle for correct type', () => {
      expect(handle.asShape()).toBe(handle);
    });

    it('asPicture() throws for wrong type', () => {
      expect(() => handle.asPicture()).toThrow('Expected picture, got shape');
    });

    it('asChart() throws for wrong type', () => {
      expect(() => handle.asChart()).toThrow('Expected chart, got shape');
    });

    it('asTextBox() throws for wrong type', () => {
      expect(() => handle.asTextBox()).toThrow('Expected textbox, got shape');
    });

    it('asDrawing() throws for wrong type', () => {
      expect(() => handle.asDrawing()).toThrow('Expected drawing, got shape');
    });

    it('throws KernelError', () => {
      expect(() => handle.asPicture()).toThrow(KernelError);
    });
  });

  // -- Delegation -----------------------------------------------------------

  describe('delegation — spatial ops', () => {
    it('move() delegates to objectsImpl.move(id, dx, dy)', async () => {
      await handle.move(10, 20);
      expect(mockObjects.move).toHaveBeenCalledWith('test-1', 10, 20);
    });

    it('resize() delegates to objectsImpl.resize(id, w, h)', async () => {
      await handle.resize(200, 100);
      expect(mockObjects.resize).toHaveBeenCalledWith('test-1', 200, 100);
    });

    it('rotate() delegates to objectsImpl.rotate(id, angle)', async () => {
      await handle.rotate(45);
      expect(mockObjects.rotate).toHaveBeenCalledWith('test-1', 45);
    });

    it('flip() delegates to objectsImpl.flip(id, axis)', async () => {
      await handle.flip('horizontal');
      expect(mockObjects.flip).toHaveBeenCalledWith('test-1', 'horizontal');
    });
  });

  describe('delegation — z-order ops', () => {
    it('bringToFront()', async () => {
      await handle.bringToFront();
      expect(mockObjects.bringToFront).toHaveBeenCalledWith('test-1');
    });

    it('sendToBack()', async () => {
      await handle.sendToBack();
      expect(mockObjects.sendToBack).toHaveBeenCalledWith('test-1');
    });

    it('bringForward()', async () => {
      await handle.bringForward();
      expect(mockObjects.bringForward).toHaveBeenCalledWith('test-1');
    });

    it('sendBackward()', async () => {
      await handle.sendBackward();
      expect(mockObjects.sendBackward).toHaveBeenCalledWith('test-1');
    });
  });

  describe('delegation — lifecycle ops', () => {
    it('delete() delegates to objectsImpl.remove(id)', async () => {
      await handle.delete();
      expect(mockObjects.remove).toHaveBeenCalledWith('test-1');
    });

    it('duplicate() delegates and returns new handle with receipt id', async () => {
      const dup = await handle.duplicate();
      expect(mockObjects.duplicate).toHaveBeenCalledWith('test-1');
      expect(dup.id).toBe('dup-1');
      expect(dup.type).toBe('shape');
    });

    it('duplicate() returns a FloatingObjectHandleImpl', async () => {
      const dup = await handle.duplicate();
      expect(dup).toBeInstanceOf(FloatingObjectHandleImpl);
    });
  });

  // -- Reads ----------------------------------------------------------------

  describe('reads', () => {
    it('getBounds() returns null when boundsReader is null', () => {
      expect(handle.getBounds()).toBeNull();
    });

    it('getBounds() delegates to boundsReader when available', () => {
      const mockBounds = { x: 10, y: 20, width: 100, height: 50, rotation: 0 };
      const reader = createMockBoundsReader(mockBounds);
      const h = new FloatingObjectHandleImpl('test-1', 'shape', mockObjects, reader);
      expect(h.getBounds()).toEqual(mockBounds);
      expect(reader.getBounds).toHaveBeenCalledWith('test-1');
    });

    it('getData() delegates to objectsImpl.getFullObject(id)', async () => {
      await handle.getData();
      expect(mockObjects.getFullObject).toHaveBeenCalledWith('test-1');
    });

    it('getData() throws when object not found', async () => {
      mockObjects.getFullObject.mockResolvedValue(null as any);
      await expect(handle.getData()).rejects.toThrow('Object test-1 not found');
    });
  });
});

// ---------------------------------------------------------------------------
// ShapeHandleImpl
// ---------------------------------------------------------------------------

describe('ShapeHandleImpl', () => {
  let mockObjects: jest.Mocked<WorksheetObjectsImpl>;
  let shape: ShapeHandleImpl;

  beforeEach(() => {
    mockObjects = createMockObjectsImpl();
    shape = new ShapeHandleImpl('shape-1', 'rect' as any, mockObjects, null);
  });

  it('stores type as "shape" and shapeType', () => {
    expect(shape.type).toBe('shape');
    expect(shape.shapeType).toBe('rect');
  });

  it('isShape() returns true', () => {
    expect(shape.isShape()).toBe(true);
  });

  it('update() delegates to objectsImpl.updateShape()', async () => {
    const props = { fill: { type: 'solid', color: '#ff0000' } };
    await shape.update(props as any);
    expect(mockObjects.updateShape).toHaveBeenCalledWith('shape-1', props);
  });

  it('duplicate() returns ShapeHandleImpl (covariant)', async () => {
    const dup = await shape.duplicate();
    expect(dup).toBeInstanceOf(ShapeHandleImpl);
    expect(dup.id).toBe('dup-1');
    expect((dup as ShapeHandleImpl).shapeType).toBe('rect');
  });

  it('getData() delegates to objectsImpl.getFullObject()', async () => {
    mockObjects.getFullObject.mockResolvedValue({
      id: 'shape-1',
      type: 'shape',
      shapeType: 'rect',
    } as any);
    await shape.getData();
    expect(mockObjects.getFullObject).toHaveBeenCalledWith('shape-1');
  });

  it('getData() throws when shape not found', async () => {
    mockObjects.getFullObject.mockResolvedValue(null as any);
    await expect(shape.getData()).rejects.toThrow('Shape shape-1 not found');
  });
});

// ---------------------------------------------------------------------------
// PictureHandleImpl
// ---------------------------------------------------------------------------

describe('PictureHandleImpl', () => {
  let mockObjects: jest.Mocked<WorksheetObjectsImpl>;
  let picture: PictureHandleImpl;

  beforeEach(() => {
    mockObjects = createMockObjectsImpl();
    picture = new PictureHandleImpl('pic-1', mockObjects, null);
  });

  it('isPicture() returns true, isShape() returns false', () => {
    expect(picture.isPicture()).toBe(true);
    expect(picture.isShape()).toBe(false);
  });

  it('update() delegates to objectsImpl.updatePicture()', async () => {
    const props = {
      crop: { top: 1, right: 2, bottom: 3, left: 4 },
      border: { style: 'solid' as const, color: '#000000', width: 1 },
    };
    await picture.update(props);
    expect(mockObjects.updatePicture).toHaveBeenCalledWith('pic-1', props);
  });

  it('duplicate() returns PictureHandleImpl (covariant)', async () => {
    const dup = await picture.duplicate();
    expect(dup).toBeInstanceOf(PictureHandleImpl);
    expect(dup.id).toBe('dup-1');
  });
});

// ---------------------------------------------------------------------------
// DrawingHandleImpl
// ---------------------------------------------------------------------------

describe('DrawingHandleImpl', () => {
  let mockObjects: jest.Mocked<WorksheetObjectsImpl>;
  let drawing: DrawingHandleImpl;

  beforeEach(() => {
    mockObjects = createMockObjectsImpl();
    drawing = new DrawingHandleImpl('draw-1', mockObjects, null);
  });

  it('isDrawing() returns true', () => {
    expect(drawing.isDrawing()).toBe(true);
  });

  it('addStroke() delegates to objectsImpl.addDrawingStroke()', async () => {
    const stroke = { id: 'stroke-1', points: [] } as any;
    await drawing.addStroke(stroke);
    expect(mockObjects.addDrawingStroke).toHaveBeenCalledWith('draw-1', stroke);
  });

  it('eraseStrokes() delegates to objectsImpl.eraseDrawingStrokes()', async () => {
    await drawing.eraseStrokes(['s1', 's2'] as any);
    expect(mockObjects.eraseDrawingStrokes).toHaveBeenCalledWith('draw-1', ['s1', 's2']);
  });

  it('clearStrokes() delegates to objectsImpl.clearDrawingStrokes()', async () => {
    await drawing.clearStrokes();
    expect(mockObjects.clearDrawingStrokes).toHaveBeenCalledWith('draw-1');
  });

  it('moveStrokes() delegates to objectsImpl.moveDrawingStrokes()', async () => {
    await drawing.moveStrokes(['s1'] as any, 5, 10);
    expect(mockObjects.moveDrawingStrokes).toHaveBeenCalledWith('draw-1', ['s1'], 5, 10);
  });

  it('findStrokesAtPoint() delegates to objectsImpl.findStrokesAtPoint()', async () => {
    await drawing.findStrokesAtPoint(100, 200, 5);
    expect(mockObjects.findStrokesAtPoint).toHaveBeenCalledWith('draw-1', 100, 200, 5);
  });

  it('duplicate() returns DrawingHandleImpl (covariant)', async () => {
    const dup = await drawing.duplicate();
    expect(dup).toBeInstanceOf(DrawingHandleImpl);
    expect(dup.id).toBe('dup-1');
  });

  it('getData() delegates to objectsImpl.getDrawing()', async () => {
    // DrawingHandleImpl has its own getData() that delegates to getDrawing()
    await drawing.getData();
    expect(mockObjects.getDrawing).toHaveBeenCalledWith('draw-1');
  });

  it('getData() throws when drawing not found', async () => {
    mockObjects.getDrawing.mockResolvedValue(null as any);
    await expect(drawing.getData()).rejects.toThrow('Drawing draw-1 not found');
  });
});

// ---------------------------------------------------------------------------
// ChartHandleImpl
// ---------------------------------------------------------------------------

describe('ChartHandleImpl', () => {
  let mockObjects: jest.Mocked<WorksheetObjectsImpl>;
  let chart: ChartHandleImpl;

  beforeEach(() => {
    mockObjects = createMockObjectsImpl();
    chart = new ChartHandleImpl('chart-1', mockObjects, null);
  });

  it('isChart() returns true, isShape() returns false', () => {
    expect(chart.isChart()).toBe(true);
    expect(chart.isShape()).toBe(false);
  });

  it('hosting ops delegate correctly (bringToFront)', async () => {
    await chart.bringToFront();
    expect(mockObjects.bringToFront).toHaveBeenCalledWith('chart-1');
  });

  it('duplicate() returns ChartHandleImpl (covariant)', async () => {
    const dup = await chart.duplicate();
    expect(dup).toBeInstanceOf(ChartHandleImpl);
    expect(dup.id).toBe('dup-1');
  });
});

// ---------------------------------------------------------------------------
// TextEffectHandleImpl
// ---------------------------------------------------------------------------

describe('TextEffectHandleImpl', () => {
  let mockObjects: jest.Mocked<WorksheetObjectsImpl>;
  let textEffects: TextEffectHandleImpl;

  beforeEach(() => {
    mockObjects = createMockObjectsImpl();
    textEffects = new TextEffectHandleImpl('wa-1', mockObjects, null);
  });

  it('isTextEffect() returns true (override)', () => {
    expect(textEffects.isTextEffect()).toBe(true);
  });

  it('isTextBox() returns true (stored as textbox type)', () => {
    // TextEffect is stored as type "textbox" internally, so inherited
    // isTextBox() checks this.type === "textbox" and returns true.
    expect(textEffects.isTextBox()).toBe(true);
  });

  it('type is "textbox" (internal storage)', () => {
    expect(textEffects.type).toBe('textbox');
  });

  it('update() delegates to objectsImpl.updateTextEffect()', async () => {
    const updates = { text: 'Hello' };
    await textEffects.update(updates as any);
    expect(mockObjects.updateTextEffect).toHaveBeenCalledWith('wa-1', updates);
  });

  it('duplicate() returns TextEffectHandleImpl (covariant)', async () => {
    const dup = await textEffects.duplicate();
    expect(dup).toBeInstanceOf(TextEffectHandleImpl);
    expect(dup.id).toBe('dup-1');
  });
});

// ---------------------------------------------------------------------------
// Handle factory — TextEffect integration
// ---------------------------------------------------------------------------

describe('createFloatingObjectHandle — text-effects', () => {
  it('creates TextEffectHandleImpl for "text-effects" type', () => {
    const mockObjects = createMockObjectsImpl();
    const handle = createFloatingObjectHandle('wa-1', 'text-effects', mockObjects, null);
    expect(handle).toBeInstanceOf(TextEffectHandleImpl);
    expect(handle.isTextEffect()).toBe(true);
  });

  it('creates TextBoxHandleImpl for "textbox" type (not TextEffect)', () => {
    const mockObjects = createMockObjectsImpl();
    const handle = createFloatingObjectHandle('tb-1', 'textbox', mockObjects, null);
    expect(handle).toBeInstanceOf(TextBoxHandleImpl);
    expect(handle.isTextEffect()).toBe(false);
  });
});
