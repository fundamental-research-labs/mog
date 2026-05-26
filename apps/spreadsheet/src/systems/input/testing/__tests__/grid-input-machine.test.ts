/**
 * Grid Input Machine - Pure State Machine Tests
 *
 * Tests the input (gesture) machine in isolation using createActor from xstate.
 * No DOM, no coordinators, no physics engines.
 *
 * The machine manages gesture states:
 * idle, scrolling, momentum, panning, pinching, zooming
 */

import { createActor } from 'xstate';

import { InputEvents, inputMachine } from '../../machines/grid-input-machine';

function createInputActor() {
  const actor = createActor(inputMachine);
  actor.start();
  return actor;
}

describe('inputMachine', () => {
  describe('scroll', () => {
    it('idle -> scrolling on WHEEL', () => {
      const actor = createInputActor();

      actor.send(InputEvents.wheel(0, 100));
      expect(actor.getSnapshot().value).toBe('scrolling');

      actor.stop();
    });

    it('scrolling -> momentum on SCROLL_END with velocity', () => {
      const actor = createInputActor();

      // Send a wheel event with enough delta to produce significant velocity
      // The machine calculates velocityX = deltaX * 10, velocityY = deltaY * 10
      // hasSignificantVelocity guard checks sqrt(vx^2 + vy^2) > 50
      // So deltaY=10 => velocityY=100, magnitude=100 > 50
      actor.send(InputEvents.wheel(0, 10));
      expect(actor.getSnapshot().value).toBe('scrolling');

      actor.send(InputEvents.scrollEnd());
      expect(actor.getSnapshot().value).toBe('momentum');

      actor.stop();
    });

    it('scrolling -> idle on SCROLL_END without velocity', () => {
      const actor = createInputActor();

      // Send a wheel event with tiny delta => velocity below threshold
      // deltaY=1 => velocityY=10, magnitude=10 < 50
      actor.send(InputEvents.wheel(0, 1));
      expect(actor.getSnapshot().value).toBe('scrolling');

      actor.send(InputEvents.scrollEnd());
      expect(actor.getSnapshot().value).toBe('idle');

      actor.stop();
    });

    it('momentum -> idle on MOMENTUM_COMPLETE', () => {
      const actor = createInputActor();

      // Get to momentum state
      actor.send(InputEvents.wheel(0, 10));
      actor.send(InputEvents.scrollEnd());
      expect(actor.getSnapshot().value).toBe('momentum');

      actor.send(InputEvents.momentumComplete());
      expect(actor.getSnapshot().value).toBe('idle');

      actor.stop();
    });
  });

  describe('zoom', () => {
    it('idle -> zooming on ZOOM', () => {
      const actor = createInputActor();

      actor.send(InputEvents.zoom(0.1, 400, 300));
      expect(actor.getSnapshot().value).toBe('zooming');

      actor.stop();
    });

    it('zooming -> idle on ZOOM_COMPLETE', () => {
      const actor = createInputActor();

      actor.send(InputEvents.zoom(0.1, 400, 300));
      expect(actor.getSnapshot().value).toBe('zooming');

      actor.send(InputEvents.zoomComplete());
      expect(actor.getSnapshot().value).toBe('idle');

      actor.stop();
    });
  });

  describe('pan', () => {
    it('idle -> panning on PAN_START', () => {
      const actor = createInputActor();

      actor.send(InputEvents.panStart(100, 200));
      expect(actor.getSnapshot().value).toBe('panning');

      actor.stop();
    });

    it('panning -> momentum on PAN_END with velocity', () => {
      const actor = createInputActor();

      actor.send(InputEvents.panStart(100, 200));
      expect(actor.getSnapshot().value).toBe('panning');

      // PAN_MOVE to build velocity in context
      actor.send(InputEvents.panMove(90, 190));

      // PAN_END with significant velocity
      // hasSignificantVelocity checks context velocity, not event velocity
      // applyPanDelta sets velocityX = deltaX * 60, velocityY = deltaY * 60
      // delta = panStart - panMove = (100-90, 200-190) = (10, 10)
      // velocity = (600, 600), magnitude = ~849 > 50
      actor.send(InputEvents.panEnd(600, 600));
      expect(actor.getSnapshot().value).toBe('momentum');

      actor.stop();
    });

    it('panning -> idle on PAN_END without velocity', () => {
      const actor = createInputActor();

      actor.send(InputEvents.panStart(100, 200));
      expect(actor.getSnapshot().value).toBe('panning');

      // PAN_END with zero velocity
      // initPan sets velocityX=0, velocityY=0, and no PAN_MOVE was sent
      // hasSignificantVelocity checks context: sqrt(0^2+0^2) = 0 < 50
      actor.send(InputEvents.panEnd(0, 0));
      expect(actor.getSnapshot().value).toBe('idle');

      actor.stop();
    });
  });

  describe('interrupt', () => {
    it('scrolling -> idle on INTERRUPT', () => {
      const actor = createInputActor();

      actor.send(InputEvents.wheel(0, 100));
      expect(actor.getSnapshot().value).toBe('scrolling');

      actor.send(InputEvents.interrupt());
      expect(actor.getSnapshot().value).toBe('idle');

      actor.stop();
    });

    it('momentum -> idle on INTERRUPT', () => {
      const actor = createInputActor();

      actor.send(InputEvents.wheel(0, 10));
      actor.send(InputEvents.scrollEnd());
      expect(actor.getSnapshot().value).toBe('momentum');

      actor.send(InputEvents.interrupt());
      expect(actor.getSnapshot().value).toBe('idle');

      actor.stop();
    });

    it('panning -> idle on INTERRUPT', () => {
      const actor = createInputActor();

      actor.send(InputEvents.panStart(100, 200));
      expect(actor.getSnapshot().value).toBe('panning');

      actor.send(InputEvents.interrupt());
      expect(actor.getSnapshot().value).toBe('idle');

      actor.stop();
    });
  });

  describe('context', () => {
    it('WHEEL updates scrollX/scrollY', () => {
      const actor = createInputActor();

      actor.send(InputEvents.wheel(5, 10));
      const ctx = actor.getSnapshot().context;
      expect(ctx.scrollX).toBe(5);
      expect(ctx.scrollY).toBe(10);

      // Subsequent wheel events accumulate
      actor.send(InputEvents.wheel(3, 7));
      const ctx2 = actor.getSnapshot().context;
      expect(ctx2.scrollX).toBe(8);
      expect(ctx2.scrollY).toBe(17);

      actor.stop();
    });

    it('ZOOM updates zoomLevel', () => {
      const actor = createInputActor();

      // Initial zoomLevel is 1
      expect(actor.getSnapshot().context.zoomLevel).toBe(1);

      // ZOOM with delta=0.1 => zoomLevel = 1 * (1 + 0.1) = 1.1
      actor.send(InputEvents.zoom(0.1, 400, 300));
      const ctx = actor.getSnapshot().context;
      expect(ctx.zoomLevel).toBeCloseTo(1.1);
      expect(ctx.zoomCenterX).toBe(400);
      expect(ctx.zoomCenterY).toBe(300);

      actor.stop();
    });
  });
});
