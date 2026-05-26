/**
 * Context Menu Slice Tests
 *
 * Tests for instanceId increment behavior that forces React remount
 * on consecutive openContextMenu calls (fixes stale floating-ui position).
 */

import { create } from 'zustand';

import { createContextMenuSlice, type ContextMenuSlice } from '../view/context-menu';

function createTestStore() {
  return create<ContextMenuSlice>()(createContextMenuSlice);
}

describe('ContextMenuSlice', () => {
  describe('instanceId', () => {
    it('should start at 0', () => {
      const store = createTestStore();
      expect(store.getState().contextMenu.instanceId).toBe(0);
    });

    it('should increment on each openContextMenu call', () => {
      const store = createTestStore();

      store.getState().openContextMenu({
        x: 100,
        y: 100,
        target: 'cell',
      });
      expect(store.getState().contextMenu.instanceId).toBe(1);

      store.getState().openContextMenu({
        x: 200,
        y: 200,
        target: 'cell',
      });
      expect(store.getState().contextMenu.instanceId).toBe(2);
    });

    it('should reset to 0 on closeContextMenu', () => {
      const store = createTestStore();

      store.getState().openContextMenu({
        x: 100,
        y: 100,
        target: 'cell',
      });
      expect(store.getState().contextMenu.instanceId).toBe(1);

      store.getState().closeContextMenu();
      expect(store.getState().contextMenu.instanceId).toBe(0);
    });

    it('should increment from 0 after close+reopen', () => {
      const store = createTestStore();

      store.getState().openContextMenu({ x: 10, y: 10, target: 'cell' });
      expect(store.getState().contextMenu.instanceId).toBe(1);

      store.getState().closeContextMenu();
      store.getState().openContextMenu({ x: 50, y: 50, target: 'row-header' });
      expect(store.getState().contextMenu.instanceId).toBe(1);
    });

    it('should produce different instanceIds for consecutive opens without close', () => {
      const store = createTestStore();

      store.getState().openContextMenu({ x: 100, y: 100, target: 'cell' });
      const id1 = store.getState().contextMenu.instanceId;

      store.getState().openContextMenu({ x: 500, y: 400, target: 'cell' });
      const id2 = store.getState().contextMenu.instanceId;

      expect(id2).not.toBe(id1);
    });
  });
});
