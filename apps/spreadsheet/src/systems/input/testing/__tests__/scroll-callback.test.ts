/**
 * Scroll/Zoom Callback Tests
 * Tests that scroll/zoom/state change callbacks work through InputSystem.
 */

import { InputSystem } from '../../input-system';

describe('InputSystem scroll/zoom callbacks', () => {
  let system: InputSystem;

  beforeEach(() => {
    system = new InputSystem({} as any);
    system.start();
  });

  afterEach(() => {
    system.dispose();
  });

  it('onScrollChange returns unsubscribe function', () => {
    const unsubscribe = system.onScrollChange(() => {});
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

  it('onZoomChange returns unsubscribe function', () => {
    const unsubscribe = system.onZoomChange(() => {});
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

  it('onStateChange returns unsubscribe function', () => {
    const unsubscribe = system.onStateChange(() => {});
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

  it('unsubscribe after dispose does not throw', () => {
    const unsubscribe = system.onScrollChange(() => {});
    system.dispose();
    expect(() => unsubscribe()).not.toThrow();
  });
});
