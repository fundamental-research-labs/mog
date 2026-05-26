/**
 * Object Insert Mode - Pure State Machine Tests
 *
 * Tests the `inserting` state in the object interaction machine using
 * createActor from xstate. No DOM, no coordinators.
 *
 * The inserting state manages drag-to-insert for new shapes:
 * idle -> inserting (START_INSERT) -> idle (COMPLETE_INSERT / CANCEL_INSERT / KEY_ESCAPE)
 *
 * @see object-interaction-machine.ts
 */

import { createActor } from 'xstate';

import {
  objectInteractionMachine,
  ObjectInteractionEvents,
} from '../../machines/object-interaction-machine';

function createObjectInteractionActor() {
  const actor = createActor(objectInteractionMachine);
  actor.start();
  return actor;
}

describe('objectInteractionMachine - inserting state', () => {
  describe('idle -> inserting', () => {
    it('START_INSERT transitions from idle to inserting with shapeType in context', () => {
      const actor = createObjectInteractionActor();

      expect(actor.getSnapshot().value).toBe('idle');

      actor.send(ObjectInteractionEvents.startInsert('rect'));

      expect(actor.getSnapshot().value).toBe('inserting');
      expect(actor.getSnapshot().context.insertShapeType).toBe('rect');
      expect(actor.getSnapshot().context.insertStartPosition).toBeNull();
      expect(actor.getSnapshot().context.insertCurrentPosition).toBeNull();

      actor.stop();
    });

    it('START_INSERT sets correct shapeType for different shape types', () => {
      const actor = createObjectInteractionActor();

      actor.send(ObjectInteractionEvents.startInsert('ellipse'));

      expect(actor.getSnapshot().value).toBe('inserting');
      expect(actor.getSnapshot().context.insertShapeType).toBe('ellipse');

      actor.stop();
    });
  });

  describe('inserting -> idle (cancel)', () => {
    it('CANCEL_INSERT returns to idle and clears insert context', () => {
      const actor = createObjectInteractionActor();

      actor.send(ObjectInteractionEvents.startInsert('rect'));
      expect(actor.getSnapshot().value).toBe('inserting');

      actor.send(ObjectInteractionEvents.cancelInsert());

      expect(actor.getSnapshot().value).toBe('idle');
      expect(actor.getSnapshot().context.insertShapeType).toBeNull();
      expect(actor.getSnapshot().context.insertStartPosition).toBeNull();
      expect(actor.getSnapshot().context.insertCurrentPosition).toBeNull();

      actor.stop();
    });
  });

  describe('inserting -> idle (escape)', () => {
    it('KEY_ESCAPE in inserting state returns to idle and clears insert context', () => {
      const actor = createObjectInteractionActor();

      actor.send(ObjectInteractionEvents.startInsert('rect'));
      expect(actor.getSnapshot().value).toBe('inserting');

      actor.send(ObjectInteractionEvents.keyEscape());

      expect(actor.getSnapshot().value).toBe('idle');
      expect(actor.getSnapshot().context.insertShapeType).toBeNull();
      expect(actor.getSnapshot().context.insertStartPosition).toBeNull();
      expect(actor.getSnapshot().context.insertCurrentPosition).toBeNull();

      actor.stop();
    });
  });

  describe('inserting -> idle (complete)', () => {
    it('COMPLETE_INSERT transitions to idle and clears insert context', () => {
      const actor = createObjectInteractionActor();

      actor.send(ObjectInteractionEvents.startInsert('rect'));
      actor.send(ObjectInteractionEvents.setInsertStart({ x: 10, y: 20 }));
      actor.send(ObjectInteractionEvents.updateInsertBounds({ x: 110, y: 120 }));

      expect(actor.getSnapshot().value).toBe('inserting');

      actor.send(ObjectInteractionEvents.completeInsert());

      expect(actor.getSnapshot().value).toBe('idle');
      expect(actor.getSnapshot().context.insertShapeType).toBeNull();
      expect(actor.getSnapshot().context.insertStartPosition).toBeNull();
      expect(actor.getSnapshot().context.insertCurrentPosition).toBeNull();

      actor.stop();
    });

    it('COMPLETE_INSERT without drag positions still transitions to idle', () => {
      const actor = createObjectInteractionActor();

      actor.send(ObjectInteractionEvents.startInsert('rect'));
      actor.send(ObjectInteractionEvents.completeInsert());

      expect(actor.getSnapshot().value).toBe('idle');

      actor.stop();
    });
  });

  describe('UPDATE_INSERT_BOUNDS only works in inserting state', () => {
    it('UPDATE_INSERT_BOUNDS from idle is ignored', () => {
      const actor = createObjectInteractionActor();

      expect(actor.getSnapshot().value).toBe('idle');

      actor.send(ObjectInteractionEvents.updateInsertBounds({ x: 50, y: 60 }));

      // Should remain in idle with no insert context changes
      expect(actor.getSnapshot().value).toBe('idle');
      expect(actor.getSnapshot().context.insertCurrentPosition).toBeNull();

      actor.stop();
    });

    it('UPDATE_INSERT_BOUNDS updates context in inserting state', () => {
      const actor = createObjectInteractionActor();

      actor.send(ObjectInteractionEvents.startInsert('rect'));
      actor.send(ObjectInteractionEvents.updateInsertBounds({ x: 50, y: 60 }));

      expect(actor.getSnapshot().value).toBe('inserting');
      expect(actor.getSnapshot().context.insertCurrentPosition).toEqual({ x: 50, y: 60 });

      actor.stop();
    });

    it('UPDATE_INSERT_BOUNDS from selected state is ignored', () => {
      const actor = createObjectInteractionActor();

      // Get to selected state
      actor.send({ type: 'SELECT_OBJECT', objectId: 'obj-1', shiftKey: false, ctrlKey: false });
      expect(actor.getSnapshot().value).toBe('selected');

      actor.send(ObjectInteractionEvents.updateInsertBounds({ x: 50, y: 60 }));

      // Should remain in selected with no insert context changes
      expect(actor.getSnapshot().value).toBe('selected');
      expect(actor.getSnapshot().context.insertCurrentPosition).toBeNull();

      actor.stop();
    });
  });

  describe('SET_INSERT_START stores position in context', () => {
    it('SET_INSERT_START records pointer-down position', () => {
      const actor = createObjectInteractionActor();

      actor.send(ObjectInteractionEvents.startInsert('rect'));
      expect(actor.getSnapshot().context.insertStartPosition).toBeNull();

      actor.send(ObjectInteractionEvents.setInsertStart({ x: 100, y: 200 }));

      expect(actor.getSnapshot().value).toBe('inserting');
      expect(actor.getSnapshot().context.insertStartPosition).toEqual({ x: 100, y: 200 });

      actor.stop();
    });

    it('SET_INSERT_START from idle is ignored', () => {
      const actor = createObjectInteractionActor();

      actor.send(ObjectInteractionEvents.setInsertStart({ x: 100, y: 200 }));

      expect(actor.getSnapshot().value).toBe('idle');
      expect(actor.getSnapshot().context.insertStartPosition).toBeNull();

      actor.stop();
    });
  });

  describe('full insert lifecycle', () => {
    it('idle -> inserting -> set start -> update bounds -> complete -> idle', () => {
      const actor = createObjectInteractionActor();

      // 1. Enter insert mode
      actor.send(ObjectInteractionEvents.startInsert('rect'));
      expect(actor.getSnapshot().value).toBe('inserting');
      expect(actor.getSnapshot().context.insertShapeType).toBe('rect');

      // 2. Pointer down (start corner)
      actor.send(ObjectInteractionEvents.setInsertStart({ x: 10, y: 20 }));
      expect(actor.getSnapshot().context.insertStartPosition).toEqual({ x: 10, y: 20 });

      // 3. Pointer move (drag to size)
      actor.send(ObjectInteractionEvents.updateInsertBounds({ x: 110, y: 120 }));
      expect(actor.getSnapshot().context.insertCurrentPosition).toEqual({ x: 110, y: 120 });

      // 4. Pointer move again (update)
      actor.send(ObjectInteractionEvents.updateInsertBounds({ x: 150, y: 160 }));
      expect(actor.getSnapshot().context.insertCurrentPosition).toEqual({ x: 150, y: 160 });

      // 5. Pointer up (complete)
      actor.send(ObjectInteractionEvents.completeInsert());
      expect(actor.getSnapshot().value).toBe('idle');
      expect(actor.getSnapshot().context.insertShapeType).toBeNull();
      expect(actor.getSnapshot().context.insertStartPosition).toBeNull();
      expect(actor.getSnapshot().context.insertCurrentPosition).toBeNull();

      actor.stop();
    });
  });

  describe('edge cases', () => {
    it('RESET from inserting returns to idle', () => {
      const actor = createObjectInteractionActor();

      actor.send(ObjectInteractionEvents.startInsert('rect'));
      actor.send(ObjectInteractionEvents.setInsertStart({ x: 10, y: 20 }));
      expect(actor.getSnapshot().value).toBe('inserting');

      actor.send(ObjectInteractionEvents.reset());

      expect(actor.getSnapshot().value).toBe('idle');
      expect(actor.getSnapshot().context.insertShapeType).toBeNull();

      actor.stop();
    });

    it('EXTERNAL_SELECTION_ACTIVE is ignored in inserting state', () => {
      const actor = createObjectInteractionActor();

      actor.send(ObjectInteractionEvents.startInsert('rect'));
      expect(actor.getSnapshot().value).toBe('inserting');

      actor.send(ObjectInteractionEvents.externalSelectionActive('cells'));

      // Should remain in inserting (protected state)
      expect(actor.getSnapshot().value).toBe('inserting');

      actor.stop();
    });
  });
});
