/**
 * Tests for Object Events (canvas-agnostic + canvas-specific)
 *
 * Verifies that the event emission layer correctly constructs
 * and emits events through the event bus for canvas object
 * lifecycle events.
 *
 * Tests cover:
 * - Universal events (core/events.ts): group, ungroup
 * - Canvas-specific events (object-events.ts): move, resize, rotate, reorder, canvas batch
 */

import { jest } from '@jest/globals';

import type { CanvasObjectEvent, ICanvasEventBus } from '@mog-sdk/contracts/objects/canvas-object';

import {
  emitBatchCanvasObjectsCreated,
  emitBatchCanvasObjectsDeleted,
  emitBatchCanvasObjectsUpdated,
  emitCanvasObjectMoved,
  emitCanvasObjectResized,
  emitCanvasObjectRotated,
  emitCanvasObjectsReordered,
  emitGroupCreated,
  emitGroupDeleted,
  type CanvasEventDeps,
  type EventEmissionDeps,
} from '../../src/floating-objects/object-events';

// =============================================================================
// Test Helpers
// =============================================================================

function createMockCanvasEventBus(): ICanvasEventBus & {
  getEmittedEvents(): CanvasObjectEvent[];
  getEmittedBatches(): CanvasObjectEvent[][];
} {
  const emittedEvents: CanvasObjectEvent[] = [];
  const emittedBatches: CanvasObjectEvent[][] = [];

  return {
    on: jest.fn(() => () => {}),
    emit: jest.fn((event: CanvasObjectEvent) => {
      emittedEvents.push(event);
    }),
    emitBatch: jest.fn((events: CanvasObjectEvent[]) => {
      emittedBatches.push(events);
    }),
    getEmittedEvents: () => emittedEvents,
    getEmittedBatches: () => emittedBatches,
  };
}

function createDeps(): EventEmissionDeps & {
  eventBus: ReturnType<typeof createMockCanvasEventBus>;
} {
  return {
    eventBus: createMockCanvasEventBus(),
  };
}

function createCanvasDeps(): CanvasEventDeps & {
  eventBus: ReturnType<typeof createMockCanvasEventBus>;
} {
  return {
    eventBus: createMockCanvasEventBus(),
  };
}

// =============================================================================
// Tests: Universal Events (core/events.ts, re-exported via object-events.ts)
// =============================================================================

describe('Universal Object Events', () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    jest.clearAllMocks();
    deps = createDeps();
  });

  // ===========================================================================
  // Group Lifecycle Events
  // ===========================================================================

  describe('emitGroupCreated', () => {
    it('should emit a canvasObject:grouped event', () => {
      emitGroupCreated(deps, {
        containerId: 'doc-1',
        groupId: 'group-1',
        memberIds: ['a', 'b', 'c'],
      });

      expect(deps.eventBus.emit).toHaveBeenCalledTimes(1);
      const event = deps.eventBus.getEmittedEvents()[0];
      expect(event.type).toBe('canvasObject:grouped');
      expect(event.containerId).toBe('doc-1');
    });
  });

  describe('emitGroupDeleted', () => {
    it('should emit a canvasObject:ungrouped event', () => {
      emitGroupDeleted(deps, {
        containerId: 'doc-1',
        groupId: 'group-1',
        memberIds: ['a', 'b'],
      });

      expect(deps.eventBus.emit).toHaveBeenCalledTimes(1);
      const event = deps.eventBus.getEmittedEvents()[0];
      expect(event.type).toBe('canvasObject:ungrouped');
      expect(event.containerId).toBe('doc-1');
    });
  });

  // ===========================================================================
  // Source Parameter
  // ===========================================================================

  describe('source parameter', () => {
    it('should default to user for group events', () => {
      emitGroupCreated(deps, { containerId: 'd', groupId: 'g', memberIds: ['a'] });
      emitGroupDeleted(deps, { containerId: 'd', groupId: 'g', memberIds: ['a'] });

      for (const event of deps.eventBus.getEmittedEvents()) {
        expect(event.source).toBe('user');
      }
    });
  });

  // ===========================================================================
  // Timestamp
  // ===========================================================================

  describe('timestamps', () => {
    it('should include a timestamp on every event', () => {
      const before = Date.now();

      emitGroupCreated(deps, { containerId: 'd', groupId: 'g', memberIds: ['a'] });
      emitGroupDeleted(deps, { containerId: 'd', groupId: 'g', memberIds: ['a'] });

      const after = Date.now();

      for (const event of deps.eventBus.getEmittedEvents()) {
        expect(event.timestamp).toBeGreaterThanOrEqual(before);
        expect(event.timestamp).toBeLessThanOrEqual(after);
      }
    });
  });
});

// =============================================================================
// Tests: Canvas-Specific Events (object-events.ts)
// =============================================================================

describe('Canvas-Specific Object Events', () => {
  let deps: ReturnType<typeof createCanvasDeps>;

  beforeEach(() => {
    jest.clearAllMocks();
    deps = createCanvasDeps();
  });

  describe('emitCanvasObjectMoved', () => {
    it('should emit a canvasObject:moved event', () => {
      emitCanvasObjectMoved(deps, {
        containerId: 'doc-1',
        objectId: 'obj-1',
        previousPosition: { x: 0, y: 0, width: 100, height: 50 },
        newPosition: { x: 10, y: 20, width: 100, height: 50 },
      });

      expect(deps.eventBus.emit).toHaveBeenCalledTimes(1);
      const event = deps.eventBus.getEmittedEvents()[0];
      expect(event.type).toBe('canvasObject:moved');
      expect(event.objectId).toBe('obj-1');
      expect(event.containerId).toBe('doc-1');
    });
  });

  describe('emitCanvasObjectResized', () => {
    it('should emit a canvasObject:resized event', () => {
      emitCanvasObjectResized(deps, {
        containerId: 'doc-1',
        objectId: 'obj-1',
        previousWidth: 100,
        previousHeight: 50,
        newWidth: 200,
        newHeight: 100,
      });

      expect(deps.eventBus.emit).toHaveBeenCalledTimes(1);
      const event = deps.eventBus.getEmittedEvents()[0];
      expect(event.type).toBe('canvasObject:resized');
      expect(event.objectId).toBe('obj-1');
    });
  });

  describe('emitCanvasObjectRotated', () => {
    it('should emit a canvasObject:rotated event', () => {
      emitCanvasObjectRotated(deps, {
        containerId: 'doc-1',
        objectId: 'obj-1',
        previousRotation: 0,
        newRotation: 45,
      });

      expect(deps.eventBus.emit).toHaveBeenCalledTimes(1);
      const event = deps.eventBus.getEmittedEvents()[0];
      expect(event.type).toBe('canvasObject:rotated');
      expect(event.objectId).toBe('obj-1');
    });
  });

  describe('emitCanvasObjectsReordered', () => {
    it('should emit canvasObject:zOrderChanged events via emitBatch', () => {
      emitCanvasObjectsReordered(deps, {
        containerId: 'doc-1',
        changes: [
          { objectId: 'c', oldZIndex: 3, newZIndex: 1 },
          { objectId: 'b', oldZIndex: 2, newZIndex: 2 },
          { objectId: 'a', oldZIndex: 1, newZIndex: 3 },
        ],
      });

      expect(deps.eventBus.emitBatch).toHaveBeenCalledTimes(1);
      const batch = deps.eventBus.getEmittedBatches()[0];
      expect(batch).toHaveLength(3);
      expect(batch[0].type).toBe('canvasObject:zOrderChanged');
      expect(batch[0].objectId).toBe('c');
    });
  });

  describe('Canvas batch events', () => {
    it('emitBatchCanvasObjectsCreated should emit batch events', () => {
      emitBatchCanvasObjectsCreated(deps, {
        containerId: 'doc-1',
        objectIds: ['a', 'b', 'c'],
      });

      expect(deps.eventBus.emitBatch).toHaveBeenCalledTimes(1);
      const batch = deps.eventBus.getEmittedBatches()[0];
      expect(batch).toHaveLength(3);
      expect(batch[0].type).toBe('canvasObject:created');
    });

    it('emitBatchCanvasObjectsDeleted should emit batch events', () => {
      emitBatchCanvasObjectsDeleted(deps, {
        containerId: 'doc-1',
        objectIds: ['a', 'b'],
      });

      expect(deps.eventBus.emitBatch).toHaveBeenCalledTimes(1);
      const batch = deps.eventBus.getEmittedBatches()[0];
      expect(batch).toHaveLength(2);
      expect(batch[0].type).toBe('canvasObject:deleted');
    });

    it('emitBatchCanvasObjectsUpdated should emit batch events', () => {
      emitBatchCanvasObjectsUpdated(deps, {
        containerId: 'doc-1',
        objectIds: ['a', 'b'],
      });

      expect(deps.eventBus.emitBatch).toHaveBeenCalledTimes(1);
      const batch = deps.eventBus.getEmittedBatches()[0];
      expect(batch).toHaveLength(2);
      expect(batch[0].type).toBe('canvasObject:updated');
    });

    it('should not emit for empty objectIds', () => {
      emitBatchCanvasObjectsCreated(deps, { containerId: 'doc-1', objectIds: [] });
      emitBatchCanvasObjectsDeleted(deps, { containerId: 'doc-1', objectIds: [] });
      emitBatchCanvasObjectsUpdated(deps, { containerId: 'doc-1', objectIds: [] });

      expect(deps.eventBus.emitBatch).not.toHaveBeenCalled();
    });
  });
});
