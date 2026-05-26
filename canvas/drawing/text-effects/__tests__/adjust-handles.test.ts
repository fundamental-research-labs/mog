/**
 * Adjustment Handle Tests
 *
 * Tests for handle positioning, adjustment clamping, and interaction.
 */
import { getAllPresetNames, getWarpPreset } from '../src/presets/registry';
import { getAdjustHandle, updateAdjustment } from '../src/warp/adjust-handles';

const TEST_WIDTH = 200;
const TEST_HEIGHT = 50;

describe('getAdjustHandle', () => {
  test('returns a valid handle for textArchUp', () => {
    const handle = getAdjustHandle('textArchUp', TEST_WIDTH, TEST_HEIGHT, 0.5);

    expect(handle).toBeDefined();
    expect(isFinite(handle.position.x)).toBe(true);
    expect(isFinite(handle.position.y)).toBe(true);
    expect(handle.min).toBe(0);
    expect(handle.max).toBe(1);
    expect(handle.current).toBe(0.5);
    expect(['horizontal', 'vertical', 'both']).toContain(handle.axis);
  });

  test('clamps adjustment to valid range', () => {
    const handleLow = getAdjustHandle('textArchUp', TEST_WIDTH, TEST_HEIGHT, -10);
    expect(handleLow.current).toBe(0); // Clamped to min

    const handleHigh = getAdjustHandle('textArchUp', TEST_WIDTH, TEST_HEIGHT, 100);
    expect(handleHigh.current).toBe(1); // Clamped to max
  });

  test('works for all presets', () => {
    const allNames = getAllPresetNames();

    for (const name of allNames) {
      const preset = getWarpPreset(name);
      const handle = getAdjustHandle(name, TEST_WIDTH, TEST_HEIGHT, preset.defaultAdjustment);

      expect(isFinite(handle.position.x)).toBe(true);
      expect(isFinite(handle.position.y)).toBe(true);
      expect(handle.min).toBeLessThanOrEqual(handle.max);
      expect(handle.current).toBeGreaterThanOrEqual(handle.min);
      expect(handle.current).toBeLessThanOrEqual(handle.max);
    }
  });

  test('textPlain returns handle with zero range', () => {
    const handle = getAdjustHandle('textPlain', TEST_WIDTH, TEST_HEIGHT, 0);
    expect(handle.min).toBe(0);
    expect(handle.max).toBe(0);
    expect(handle.current).toBe(0);
  });

  test('handle position changes with adjustment', () => {
    const handle1 = getAdjustHandle('textArchUp', TEST_WIDTH, TEST_HEIGHT, 0.2);
    const handle2 = getAdjustHandle('textArchUp', TEST_WIDTH, TEST_HEIGHT, 0.8);

    // Handles at different adjustments should generally have different positions
    expect(
      handle1.position.x !== handle2.position.x || handle1.position.y !== handle2.position.y,
    ).toBe(true);
  });
});

describe('updateAdjustment', () => {
  test('updates adjustment from handle delta', () => {
    const newAdj = updateAdjustment('textArchUp', { x: 0, y: -10 }, 0.5);
    expect(newAdj).toBeGreaterThan(0.5); // Moving up increases adjustment
  });

  test('clamps to min', () => {
    const newAdj = updateAdjustment('textArchUp', { x: 0, y: 1000 }, 0.1);
    expect(newAdj).toBeGreaterThanOrEqual(0);
  });

  test('clamps to max', () => {
    const newAdj = updateAdjustment('textArchUp', { x: 0, y: -1000 }, 0.9);
    expect(newAdj).toBeLessThanOrEqual(1);
  });

  test('zero delta returns approximately the same adjustment', () => {
    const newAdj = updateAdjustment('textArchUp', { x: 0, y: 0 }, 0.5);
    expect(newAdj).toBeCloseTo(0.5, 2);
  });

  test('textPlain adjustment stays at 0', () => {
    const newAdj = updateAdjustment('textPlain', { x: 0, y: -100 }, 0);
    expect(newAdj).toBe(0); // Min and max are both 0
  });
});
