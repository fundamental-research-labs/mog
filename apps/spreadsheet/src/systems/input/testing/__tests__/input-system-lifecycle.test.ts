/**
 * InputSystem Lifecycle Tests
 * Tests InputSystem lifecycle: construction, start, dispose,
 * and idempotency of lifecycle methods.
 */

import { InputSystem } from '../../input-system';

describe('InputSystem lifecycle', () => {
  it('can be created with empty config', () => {
    const system = new InputSystem({} as any);
    expect(system).toBeDefined();
  });

  it('start() initializes paneFocus actor', () => {
    const system = new InputSystem({} as any);
    system.start();
    // Verify paneFocusActor is running by checking access layer
    expect(system.access.actors.paneFocus).toBeDefined();
    const snapshot = system.access.actors.paneFocus.getSnapshot();
    expect(snapshot.value).toBe('grid');
    system.dispose();
  });

  it('dispose() cleans up without errors', () => {
    const system = new InputSystem({} as any);
    system.start();
    expect(() => system.dispose()).not.toThrow();
  });

  it('double-start is a no-op', () => {
    const system = new InputSystem({} as any);
    system.start();
    expect(() => system.start()).not.toThrow();
    system.dispose();
  });

  it('double-dispose is a no-op', () => {
    const system = new InputSystem({} as any);
    system.start();
    system.dispose();
    expect(() => system.dispose()).not.toThrow();
  });

  it('exposes inputCoordinator', () => {
    const system = new InputSystem({} as any);
    expect(system.inputCoordinator).toBeDefined();
    system.dispose();
  });

  it('exposes keyboardCoordinator', () => {
    const system = new InputSystem({} as any);
    expect(system.keyboardCoordinator).toBeDefined();
    system.dispose();
  });
});
