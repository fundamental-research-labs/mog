/**
 * All Presets Test
 *
 * Every single warp preset (all registered presets) generates valid guide paths.
 * Snapshot test for each preset at default adjustment with a standard bounding box.
 */
import { Diagnostics, PathOps } from '@mog/geometry';
import {
  getAllPresetNames,
  getPresetCount,
  getWarpPreset,
  isValidPresetName,
} from '../../src/presets/registry';

// Standard test dimensions
const TEST_WIDTH = 200;
const TEST_HEIGHT = 50;

describe('Warp Preset Registry', () => {
  test('has all expected presets registered', () => {
    const names = getAllPresetNames();
    expect(names.length).toBe(41);
    expect(getPresetCount()).toBe(names.length);
  });

  test('isValidPresetName returns true for valid names', () => {
    expect(isValidPresetName('textArchUp')).toBe(true);
    expect(isValidPresetName('textPlain')).toBe(true);
    expect(isValidPresetName('textWave1')).toBe(true);
  });

  test('isValidPresetName returns false for invalid names', () => {
    expect(isValidPresetName('notARealPreset')).toBe(false);
    expect(isValidPresetName('')).toBe(false);
    expect(isValidPresetName('textFoo')).toBe(false);
  });

  test('getWarpPreset throws for unknown preset', () => {
    expect(() => getWarpPreset('notARealPreset' as any)).toThrow('Unknown warp preset');
  });
});

describe('All Presets Generate Valid Guide Paths', () => {
  const allNames = getAllPresetNames();

  test.each(allNames)('preset "%s" generates valid top guide path', (name) => {
    const preset = getWarpPreset(name);
    const topPath = preset.topGuide(TEST_WIDTH, TEST_HEIGHT, preset.defaultAdjustment);

    // Path must have segments
    expect(topPath.segments.length).toBeGreaterThan(0);

    // Path must start with a MoveTo
    expect(topPath.segments[0].type).toBe('M');

    // Path must pass geometry validation (no NaN, no degenerate)
    const validation = Diagnostics.validatePath(topPath);
    expect(validation.valid).toBe(true);
  });

  test.each(allNames)('preset "%s" generates valid bottom guide path', (name) => {
    const preset = getWarpPreset(name);
    const bottomPath = preset.bottomGuide(TEST_WIDTH, TEST_HEIGHT, preset.defaultAdjustment);

    expect(bottomPath.segments.length).toBeGreaterThan(0);
    expect(bottomPath.segments[0].type).toBe('M');

    const validation = Diagnostics.validatePath(bottomPath);
    expect(validation.valid).toBe(true);
  });

  test.each(allNames)('preset "%s" has valid adjustment range', (name) => {
    const preset = getWarpPreset(name);

    expect(preset.minAdjustment).toBeLessThanOrEqual(preset.maxAdjustment);
    expect(preset.defaultAdjustment).toBeGreaterThanOrEqual(preset.minAdjustment);
    expect(preset.defaultAdjustment).toBeLessThanOrEqual(preset.maxAdjustment);
    expect(isFinite(preset.defaultAdjustment)).toBe(true);
  });
});

describe('Preset Snapshots (default adjustment)', () => {
  const allNames = getAllPresetNames();

  test.each(allNames)('preset "%s" top guide snapshot', (name) => {
    const preset = getWarpPreset(name);
    const topPath = preset.topGuide(TEST_WIDTH, TEST_HEIGHT, preset.defaultAdjustment);
    const svgString = PathOps.pathToSvgString(topPath);
    expect(svgString).toMatchSnapshot();
  });

  test.each(allNames)('preset "%s" bottom guide snapshot', (name) => {
    const preset = getWarpPreset(name);
    const bottomPath = preset.bottomGuide(TEST_WIDTH, TEST_HEIGHT, preset.defaultAdjustment);
    const svgString = PathOps.pathToSvgString(bottomPath);
    expect(svgString).toMatchSnapshot();
  });
});

describe('Presets at Extreme Adjustments', () => {
  const allNames = getAllPresetNames();

  test.each(allNames)('preset "%s" at minimum adjustment produces valid paths', (name) => {
    const preset = getWarpPreset(name);
    const topPath = preset.topGuide(TEST_WIDTH, TEST_HEIGHT, preset.minAdjustment);
    const bottomPath = preset.bottomGuide(TEST_WIDTH, TEST_HEIGHT, preset.minAdjustment);

    expect(Diagnostics.validatePath(topPath).valid).toBe(true);
    expect(Diagnostics.validatePath(bottomPath).valid).toBe(true);
  });

  test.each(allNames)('preset "%s" at maximum adjustment produces valid paths', (name) => {
    const preset = getWarpPreset(name);
    const topPath = preset.topGuide(TEST_WIDTH, TEST_HEIGHT, preset.maxAdjustment);
    const bottomPath = preset.bottomGuide(TEST_WIDTH, TEST_HEIGHT, preset.maxAdjustment);

    expect(Diagnostics.validatePath(topPath).valid).toBe(true);
    expect(Diagnostics.validatePath(bottomPath).valid).toBe(true);
  });
});

describe('Presets with Various Dimensions', () => {
  const testCases = [
    { width: 100, height: 20 },
    { width: 500, height: 100 },
    { width: 50, height: 50 }, // Square
    { width: 300, height: 10 }, // Very wide
    { width: 10, height: 100 }, // Very tall
  ];

  const samplePresets = [
    'textArchUp',
    'textWave1',
    'textInflate',
    'textFadeRight',
    'textSlantUp',
  ] as const;

  for (const preset of samplePresets) {
    for (const dims of testCases) {
      test(`${preset} at ${dims.width}x${dims.height} produces valid paths`, () => {
        const p = getWarpPreset(preset);
        const topPath = p.topGuide(dims.width, dims.height, p.defaultAdjustment);
        const bottomPath = p.bottomGuide(dims.width, dims.height, p.defaultAdjustment);

        expect(Diagnostics.validatePath(topPath).valid).toBe(true);
        expect(Diagnostics.validatePath(bottomPath).valid).toBe(true);
      });
    }
  }
});
