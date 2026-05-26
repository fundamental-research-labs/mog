/**
 * Registry Coverage Test
 *
 * Verifies that ALL 41 ST_TextShapeType values from ECMA-376 are registered
 * in the warp preset registry. This is a completeness guard: if a preset is
 * added to the OOXML spec type but not registered, this test will fail.
 */
import { getAllPresetNames, getPresetCount, getWarpPreset } from '../../src/presets/registry';

/**
 * The complete list of 41 ECMA-376 ST_TextShapeType values.
 * Reference: ECMA-376 Part 1, section 20.1.10.76
 */
const ALL_41_PRESETS = [
  'textNoShape',
  'textPlain',
  'textStop',
  'textTriangle',
  'textTriangleInverted',
  'textChevron',
  'textChevronInverted',
  'textRingInside',
  'textRingOutside',
  'textArchUp',
  'textArchDown',
  'textCircle',
  'textButton',
  'textArchUpPour',
  'textArchDownPour',
  'textCirclePour',
  'textButtonPour',
  'textCurveUp',
  'textCurveDown',
  'textCanUp',
  'textCanDown',
  'textWave1',
  'textWave2',
  'textDoubleWave1',
  'textWave4',
  'textInflate',
  'textDeflate',
  'textInflateBottom',
  'textDeflateBottom',
  'textInflateTop',
  'textDeflateTop',
  'textDeflateInflate',
  'textDeflateInflateDeflate',
  'textFadeRight',
  'textFadeLeft',
  'textFadeUp',
  'textFadeDown',
  'textSlantUp',
  'textSlantDown',
  'textCascadeUp',
  'textCascadeDown',
] as const;

describe('TextEffect warp preset registry coverage', () => {
  it('should have exactly 41 registered presets', () => {
    expect(getPresetCount()).toBe(41);
  });

  it('should have all 41 ST_TextShapeType values registered', () => {
    expect(ALL_41_PRESETS).toHaveLength(41);
    for (const name of ALL_41_PRESETS) {
      expect(() => getWarpPreset(name)).not.toThrow();
      const preset = getWarpPreset(name);
      expect(preset).toBeDefined();
      expect(preset.name).toBe(name);
    }
  });

  it('getAllPresetNames should return all 41 names', () => {
    const names = getAllPresetNames();
    expect(names).toHaveLength(41);
    for (const expected of ALL_41_PRESETS) {
      expect(names).toContain(expected);
    }
  });

  it('registry should not contain any names outside the ECMA-376 spec', () => {
    const names = getAllPresetNames();
    const specSet = new Set<string>(ALL_41_PRESETS);
    for (const name of names) {
      expect(specSet.has(name)).toBe(true);
    }
  });
});
