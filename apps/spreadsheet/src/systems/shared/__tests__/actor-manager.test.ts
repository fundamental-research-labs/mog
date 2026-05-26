/**
 * ActorManager Tests
 *
 * Tests for the ActorManager class that manages XState actor lifecycle.
 *
 */

import { jest } from '@jest/globals';

import { ActorManager } from '../actor-manager';

describe('ActorManager', () => {
  describe('construction', () => {
    it('creates all actors', () => {
      const manager = new ActorManager();

      expect(manager.selection).toBeDefined();
      expect(manager.editor).toBeDefined();
      expect(manager.clipboard).toBeDefined();
      expect(manager.renderer).toBeDefined();
      expect(manager.focus).toBeDefined();
      expect(manager.objectInteraction).toBeDefined();
      expect(manager.chart).toBeDefined();
      expect(manager.diagram).toBeDefined();
    });

    it('creates actors with inspect callback when provided', () => {
      const inspect = jest.fn();
      const manager = new ActorManager({ inspect });

      // Actors should be created (we can't directly verify inspect was passed,
      // but we can verify actors exist)
      expect(manager.selection).toBeDefined();
      expect(manager.editor).toBeDefined();
    });

    it('does not start actors on construction', () => {
      const manager = new ActorManager();

      expect(manager.isStarted()).toBe(false);
      expect(manager.isStopped()).toBe(false);
    });
  });

  describe('start', () => {
    it('starts all actors', () => {
      const manager = new ActorManager();
      manager.start();

      expect(manager.isStarted()).toBe(true);
      expect(manager.isStopped()).toBe(false);

      // Verify actors are in their initial states
      expect(manager.selection.getSnapshot().value).toBeDefined();
      expect(manager.editor.getSnapshot().value).toBeDefined();
      expect(manager.clipboard.getSnapshot().value).toBeDefined();
      expect(manager.renderer.getSnapshot().value).toBeDefined();
      expect(manager.focus.getSnapshot().value).toBeDefined();
      expect(manager.objectInteraction.getSnapshot().value).toBeDefined();
      expect(manager.chart.getSnapshot().value).toBeDefined();
      expect(manager.diagram.getSnapshot().value).toBeDefined();

      // Clean up
      manager.stop();
    });

    it('is idempotent - multiple starts have no effect', () => {
      const manager = new ActorManager();

      manager.start();
      const selectionState1 = manager.selection.getSnapshot();

      manager.start(); // Should be no-op
      const selectionState2 = manager.selection.getSnapshot();

      // States should be identical (same reference since no events were sent)
      expect(selectionState1).toBe(selectionState2);
      expect(manager.isStarted()).toBe(true);

      manager.stop();
    });

    it('throws if called after stop', () => {
      const manager = new ActorManager();
      manager.start();
      manager.stop();

      expect(() => manager.start()).toThrow('Cannot restart after stop');
    });
  });

  describe('stop', () => {
    it('stops all actors', () => {
      const manager = new ActorManager();
      manager.start();
      manager.stop();

      expect(manager.isStarted()).toBe(true); // Was started
      expect(manager.isStopped()).toBe(true); // Now stopped
    });

    it('is idempotent - multiple stops have no effect', () => {
      const manager = new ActorManager();
      manager.start();

      manager.stop();
      expect(manager.isStopped()).toBe(true);

      // Should not throw or have any effect
      manager.stop();
      expect(manager.isStopped()).toBe(true);
    });

    it('does nothing if never started', () => {
      const manager = new ActorManager();

      // Should not throw
      manager.stop();

      expect(manager.isStarted()).toBe(false);
      expect(manager.isStopped()).toBe(false);
    });
  });

  describe('getActorRefs', () => {
    it('returns all actor references', () => {
      const manager = new ActorManager();
      const refs = manager.getActorRefs();

      expect(refs.selectionActor).toBe(manager.selection);
      expect(refs.editorActor).toBe(manager.editor);
      expect(refs.clipboardActor).toBe(manager.clipboard);
      expect(refs.rendererActor).toBe(manager.renderer);
      expect(refs.focusActor).toBe(manager.focus);
      expect(refs.objectInteractionActor).toBe(manager.objectInteraction);
      expect(refs.chartActor).toBe(manager.chart);
      expect(refs.diagramActor).toBe(manager.diagram);
    });
  });

  describe('actor interaction', () => {
    it('allows sending events to started actors', () => {
      const manager = new ActorManager();
      manager.start();

      // Send an event to selection actor
      const initialState = manager.selection.getSnapshot();
      expect(initialState.context.activeCell).toEqual({ row: 0, col: 0 });

      // Move selection
      manager.selection.send({
        type: 'MOUSE_DOWN',
        cell: { row: 5, col: 3 },
        shiftKey: false,
        ctrlKey: false,
      });

      const newState = manager.selection.getSnapshot();
      expect(newState.context.activeCell).toEqual({ row: 5, col: 3 });

      manager.stop();
    });
  });
});
