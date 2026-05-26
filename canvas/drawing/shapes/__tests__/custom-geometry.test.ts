/**
 * Tests for custom geometry module.
 *
 * Covers: evaluateGuides, resolveOoxmlPath, resolveOoxmlPaths,
 *         customGeometryToPath, parseCustomGeometry.
 */
import type { GeometryPath, GeometryPathCommand } from '@mog-sdk/contracts/diagram';
import type { CustomGuide, CustomPath, CustomPathCommand } from '../src/custom-geometry';
import {
  customGeometryToPath,
  evaluateGuides,
  parseCustomGeometry,
  resolveOoxmlPath,
  resolveOoxmlPaths,
} from '../src/custom-geometry';

// =============================================================================
// evaluateGuides
// =============================================================================

describe('evaluateGuides', () => {
  // ── Basic operations ────────────────────────────────────────────────────────

  describe('basic operations', () => {
    it('val: returns the literal value', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'val 100' }];
      const result = evaluateGuides(guides, 200, 100);
      expect(result.get('g1')).toBe(100);
    });

    it('val: resolves a variable reference', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'val w' }];
      const result = evaluateGuides(guides, 200, 100);
      expect(result.get('g1')).toBe(200);
    });

    it('+-: addition and subtraction', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: '+- 100 50 0' }];
      const result = evaluateGuides(guides, 200, 100);
      expect(result.get('g1')).toBe(150);
    });

    it('+-: subtraction part works', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: '+- 100 50 30' }];
      const result = evaluateGuides(guides, 200, 100);
      expect(result.get('g1')).toBe(120); // 100 + 50 - 30
    });

    it('*/: multiply then divide', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: '*/ 100 3 2' }];
      const result = evaluateGuides(guides, 200, 100);
      expect(result.get('g1')).toBe(150); // 100 * 3 / 2
    });

    it('*/: divide by zero returns 0', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: '*/ 100 3 0' }];
      const result = evaluateGuides(guides, 200, 100);
      expect(result.get('g1')).toBe(0);
    });

    it('+/: add then divide', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: '+/ 100 50 3' }];
      const result = evaluateGuides(guides, 200, 100);
      expect(result.get('g1')).toBe(50); // (100 + 50) / 3
    });

    it('+/: divide by zero returns 0', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: '+/ 100 50 0' }];
      const result = evaluateGuides(guides, 200, 100);
      expect(result.get('g1')).toBe(0);
    });
  });

  // ── Built-in variables ──────────────────────────────────────────────────────

  describe('built-in variables', () => {
    const width = 600;
    const height = 400;

    it('w and h are set from dimensions', () => {
      const guides: CustomGuide[] = [
        { name: 'gw', formula: 'val w' },
        { name: 'gh', formula: 'val h' },
      ];
      const result = evaluateGuides(guides, width, height);
      expect(result.get('gw')).toBe(width);
      expect(result.get('gh')).toBe(height);
    });

    it('wd2 and hd2 are halves', () => {
      const result = evaluateGuides([], width, height);
      expect(result.get('wd2')).toBe(width / 2);
      expect(result.get('hd2')).toBe(height / 2);
    });

    it('wd4 and hd4 are quarters', () => {
      const result = evaluateGuides([], width, height);
      expect(result.get('wd4')).toBe(width / 4);
      expect(result.get('hd4')).toBe(height / 4);
    });

    it('ss is min(w, h) and ls is max(w, h)', () => {
      const result = evaluateGuides([], width, height);
      expect(result.get('ss')).toBe(Math.min(width, height));
      expect(result.get('ls')).toBe(Math.max(width, height));
    });

    it('ssd2/ssd4/ssd6/ssd8 are fractions of ss', () => {
      const ss = Math.min(width, height);
      const result = evaluateGuides([], width, height);
      expect(result.get('ssd2')).toBe(ss / 2);
      expect(result.get('ssd4')).toBe(ss / 4);
      expect(result.get('ssd6')).toBe(ss / 6);
      expect(result.get('ssd8')).toBe(ss / 8);
    });

    it('l, t, r, b are edges', () => {
      const result = evaluateGuides([], width, height);
      expect(result.get('l')).toBe(0);
      expect(result.get('t')).toBe(0);
      expect(result.get('r')).toBe(width);
      expect(result.get('b')).toBe(height);
    });

    it('cd2 is 180 degrees in OOXML angle units', () => {
      const result = evaluateGuides([], 100, 100);
      expect(result.get('cd2')).toBe(10800000);
    });

    it('cd4 is 90 degrees in OOXML angle units', () => {
      const result = evaluateGuides([], 100, 100);
      expect(result.get('cd4')).toBe(5400000);
    });

    it('cd8 is 45 degrees in OOXML angle units', () => {
      const result = evaluateGuides([], 100, 100);
      expect(result.get('cd8')).toBe(2700000);
    });

    it('3cd4 is 270 degrees in OOXML angle units', () => {
      const result = evaluateGuides([], 100, 100);
      expect(result.get('3cd4')).toBe(16200000);
    });
  });

  // ── Guide chaining (referencing earlier guides) ─────────────────────────────

  describe('guide chaining', () => {
    it('a later guide can reference an earlier guide', () => {
      const guides: CustomGuide[] = [
        { name: 'g1', formula: 'val 100' },
        { name: 'g2', formula: '+- g1 50 0' },
      ];
      const result = evaluateGuides(guides, 200, 100);
      expect(result.get('g1')).toBe(100);
      expect(result.get('g2')).toBe(150); // 100 + 50 - 0
    });

    it('multi-step chain computes correctly', () => {
      const guides: CustomGuide[] = [
        { name: 'a', formula: 'val w' },
        { name: 'b', formula: '*/ a 1 2' }, // w / 2
        { name: 'c', formula: '+- b 10 0' }, // w / 2 + 10
      ];
      const result = evaluateGuides(guides, 200, 100);
      expect(result.get('a')).toBe(200);
      expect(result.get('b')).toBe(100);
      expect(result.get('c')).toBe(110);
    });
  });

  // ── Trig and math operations ────────────────────────────────────────────────

  describe('trig operations', () => {
    it('sin: a * sin(b) where b is OOXML angle units', () => {
      // sin(90 degrees) = 1; OOXML 90 deg = 5400000
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'sin 100 5400000' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBeCloseTo(100, 5); // 100 * sin(90 deg)
    });

    it('cos: a * cos(b) where b is OOXML angle units', () => {
      // cos(0 degrees) = 1
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'cos 100 0' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBeCloseTo(100, 5); // 100 * cos(0)
    });

    it('cos: cos(90 deg) is approximately 0', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'cos 100 5400000' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBeCloseTo(0, 5); // 100 * cos(90 deg)
    });

    it('tan: a * tan(b) where b is OOXML angle units', () => {
      // tan(45 degrees) = 1; OOXML 45 deg = 2700000
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'tan 100 2700000' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBeCloseTo(100, 4); // 100 * tan(45 deg)
    });

    it('at2: atan2(y, x) in OOXML angle units', () => {
      // atan2(1, 1) = 45 degrees = 2700000 OOXML units
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'at2 1 1' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBeCloseTo(2700000, -1);
    });

    it('cat2: a * cos(atan2(b, c))', () => {
      // atan2(1, 1) = pi/4, cos(pi/4) = sqrt(2)/2
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'cat2 100 1 1' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBeCloseTo(100 * Math.cos(Math.atan2(1, 1)), 5);
    });

    it('sat2: a * sin(atan2(b, c))', () => {
      // atan2(1, 1) = pi/4, sin(pi/4) = sqrt(2)/2
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'sat2 100 1 1' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBeCloseTo(100 * Math.sin(Math.atan2(1, 1)), 5);
    });
  });

  describe('math operations', () => {
    it('min: returns the smaller of two values', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'min 30 50' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBe(30);
    });

    it('max: returns the larger of two values', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'max 30 50' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBe(50);
    });

    it('abs: returns absolute value', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'abs -42' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBe(42);
    });

    it('abs: positive value unchanged', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'abs 42' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBe(42);
    });

    it('sqrt: returns square root of absolute value', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'sqrt 144' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBe(12);
    });

    it('sqrt: handles negative argument by taking abs first', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'sqrt -144' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBe(12);
    });

    it('mod: returns sqrt(a^2 + b^2 + c^2)', () => {
      // 3^2 + 4^2 + 0^2 = 25, sqrt(25) = 5
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'mod 3 4 0' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBe(5);
    });

    it('mod: three-dimensional case', () => {
      // 1^2 + 2^2 + 2^2 = 9, sqrt(9) = 3
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'mod 1 2 2' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBe(3);
    });

    it('pin: clamps value within range', () => {
      // pin(10, 5, 20) -> 5 is within range -> 5
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'pin 10 5 20' }];
      const result = evaluateGuides(guides, 100, 100);
      // b=5 < a=10, so result = a = 10
      expect(result.get('g1')).toBe(10);
    });

    it('pin: value below minimum returns minimum', () => {
      // pin(10, 5, 20) -> b=5 < a=10, result = a=10
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'pin 10 5 20' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBe(10);
    });

    it('pin: value above maximum returns maximum', () => {
      // pin(10, 25, 20) -> b=25 > c=20, result = c=20
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'pin 10 25 20' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBe(20);
    });

    it('pin: value within range returns value', () => {
      // pin(10, 15, 20) -> b=15 is in range, result = b=15
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'pin 10 15 20' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBe(15);
    });
  });

  // ── Ternary ─────────────────────────────────────────────────────────────────

  describe('ternary (?: operator)', () => {
    it('returns b when a > 0', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: '?: 1 100 200' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBe(100);
    });

    it('returns c when a <= 0', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: '?: 0 100 200' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBe(200);
    });

    it('returns c when a is negative', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: '?: -5 100 200' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBe(200);
    });
  });

  // ── Unknown operation ───────────────────────────────────────────────────────

  describe('unknown operation', () => {
    it('uses value override from CustomGuide if available', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'unknownOp 1 2 3', value: 42 }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBe(42);
    });

    it('falls back to 0 when no value override', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'unknownOp 1 2 3' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBe(0);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('empty guide list returns only built-in variables', () => {
      const result = evaluateGuides([], 200, 100);
      expect(result.get('w')).toBe(200);
      expect(result.get('h')).toBe(100);
      // No custom guides should be present, only built-ins
      expect(result.has('g1')).toBe(false);
    });

    it('unresolvable variable reference returns 0', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'val nonExistent' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBe(0);
    });

    it('formulas with extra whitespace are handled', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: '  val   100  ' }];
      const result = evaluateGuides(guides, 100, 100);
      expect(result.get('g1')).toBe(100);
    });
  });
});

// =============================================================================
// resolveOoxmlPath
// =============================================================================

describe('resolveOoxmlPath', () => {
  const guideMap = new Map<string, number>([
    ['g1', 50],
    ['g2', 75],
    ['g3', 100],
    ['g4', 200],
  ]);

  it('resolves moveTo with numeric coordinates', () => {
    const commands: GeometryPathCommand[] = [{ type: 'moveTo', x: '10', y: '20' }];
    const result = resolveOoxmlPath(commands, guideMap);
    expect(result).toEqual([{ type: 'moveTo', x: 10, y: 20 }]);
  });

  it('resolves moveTo with guide references', () => {
    const commands: GeometryPathCommand[] = [{ type: 'moveTo', x: 'g1', y: 'g2' }];
    const result = resolveOoxmlPath(commands, guideMap);
    expect(result).toEqual([{ type: 'moveTo', x: 50, y: 75 }]);
  });

  it('resolves lineTo', () => {
    const commands: GeometryPathCommand[] = [{ type: 'lineTo', x: 'g3', y: '30' }];
    const result = resolveOoxmlPath(commands, guideMap);
    expect(result).toEqual([{ type: 'lineTo', x: 100, y: 30 }]);
  });

  it('resolves cubicBezTo (x3/y3 -> x/y)', () => {
    const commands: GeometryPathCommand[] = [
      {
        type: 'cubicBezTo',
        x1: '10',
        y1: '20',
        x2: '30',
        y2: '40',
        x3: 'g1',
        y3: 'g2',
      },
    ];
    const result = resolveOoxmlPath(commands, guideMap);
    expect(result).toEqual([
      {
        type: 'cubicBezTo',
        x1: 10,
        y1: 20,
        x2: 30,
        y2: 40,
        x: 50, // resolved from g1
        y: 75, // resolved from g2
      },
    ]);
  });

  it('resolves quadBezTo (x2/y2 -> x/y)', () => {
    const commands: GeometryPathCommand[] = [
      {
        type: 'quadBezTo',
        x1: '10',
        y1: '20',
        x2: 'g3',
        y2: 'g4',
      },
    ];
    const result = resolveOoxmlPath(commands, guideMap);
    expect(result).toEqual([
      {
        type: 'quadBezTo',
        x1: 10,
        y1: 20,
        x: 100, // resolved from g3
        y: 200, // resolved from g4
      },
    ]);
  });

  it('resolves arcTo', () => {
    const commands: GeometryPathCommand[] = [
      {
        type: 'arcTo',
        wR: 'g1',
        hR: 'g2',
        stAng: '0',
        swAng: '5400000',
      },
    ];
    const result = resolveOoxmlPath(commands, guideMap);
    expect(result).toEqual([
      {
        type: 'arcTo',
        rx: 50,
        ry: 75,
        startAngle: 0,
        sweepAngle: 5400000,
      },
    ]);
  });

  it('resolves close command', () => {
    const commands: GeometryPathCommand[] = [{ type: 'close' }];
    const result = resolveOoxmlPath(commands, guideMap);
    expect(result).toEqual([{ type: 'close' }]);
  });

  it('resolves a sequence of mixed commands', () => {
    const commands: GeometryPathCommand[] = [
      { type: 'moveTo', x: '0', y: '0' },
      { type: 'lineTo', x: 'g3', y: '0' },
      { type: 'lineTo', x: 'g3', y: 'g2' },
      { type: 'close' },
    ];
    const result = resolveOoxmlPath(commands, guideMap);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ type: 'moveTo', x: 0, y: 0 });
    expect(result[1]).toEqual({ type: 'lineTo', x: 100, y: 0 });
    expect(result[2]).toEqual({ type: 'lineTo', x: 100, y: 75 });
    expect(result[3]).toEqual({ type: 'close' });
  });

  it('returns 0 for unknown guide references', () => {
    const commands: GeometryPathCommand[] = [{ type: 'moveTo', x: 'unknown', y: 'missing' }];
    const result = resolveOoxmlPath(commands, guideMap);
    expect(result).toEqual([{ type: 'moveTo', x: 0, y: 0 }]);
  });
});

// =============================================================================
// resolveOoxmlPaths
// =============================================================================

describe('resolveOoxmlPaths', () => {
  const guideMap = new Map<string, number>([
    ['g1', 50],
    ['g2', 100],
  ]);

  it('converts a single OOXML path to CustomPath', () => {
    const ooxmlPaths: GeometryPath[] = [
      {
        w: 200,
        h: 100,
        fill: 'norm',
        stroke: true,
        commands: [
          { type: 'moveTo', x: '0', y: '0' },
          { type: 'lineTo', x: 'g2', y: 'g1' },
          { type: 'close' },
        ],
      },
    ];
    const result = resolveOoxmlPaths(ooxmlPaths, guideMap);
    expect(result).toHaveLength(1);
    expect(result[0].width).toBe(200);
    expect(result[0].height).toBe(100);
    expect(result[0].fill).toBe('norm');
    expect(result[0].stroke).toBe(true);
    expect(result[0].commands).toHaveLength(3);
    expect(result[0].commands[1]).toEqual({ type: 'lineTo', x: 100, y: 50 });
  });

  it('converts multiple OOXML paths', () => {
    const ooxmlPaths: GeometryPath[] = [
      {
        w: 100,
        h: 100,
        commands: [{ type: 'moveTo', x: '0', y: '0' }, { type: 'close' }],
      },
      {
        w: 200,
        h: 200,
        commands: [{ type: 'moveTo', x: 'g1', y: 'g2' }, { type: 'close' }],
      },
    ];
    const result = resolveOoxmlPaths(ooxmlPaths, guideMap);
    expect(result).toHaveLength(2);
    expect(result[0].width).toBe(100);
    expect(result[1].width).toBe(200);
    expect(result[1].commands[0]).toEqual({ type: 'moveTo', x: 50, y: 100 });
  });

  it('handles paths with undefined optional fields', () => {
    const ooxmlPaths: GeometryPath[] = [
      {
        commands: [{ type: 'moveTo', x: '10', y: '20' }],
      } as GeometryPath,
    ];
    const result = resolveOoxmlPaths(ooxmlPaths, guideMap);
    expect(result).toHaveLength(1);
    expect(result[0].width).toBeUndefined();
    expect(result[0].height).toBeUndefined();
    expect(result[0].fill).toBeUndefined();
    expect(result[0].stroke).toBeUndefined();
  });
});

// =============================================================================
// customGeometryToPath
// =============================================================================

describe('customGeometryToPath', () => {
  describe('simple geometry (single path)', () => {
    it('creates a path from moveTo and lineTo commands', () => {
      const guides: CustomGuide[] = [];
      const paths: CustomPath[] = [
        {
          width: 100,
          height: 100,
          commands: [
            { type: 'moveTo', x: 0, y: 0 },
            { type: 'lineTo', x: 100, y: 0 },
            { type: 'lineTo', x: 100, y: 100 },
            { type: 'lineTo', x: 0, y: 100 },
            { type: 'close' },
          ],
        },
      ];
      const result = customGeometryToPath(guides, paths, { width: 100, height: 100 });

      expect(result.segments).toHaveLength(5);
      expect(result.segments[0]).toEqual({ type: 'M', x: 0, y: 0 });
      expect(result.segments[1]).toEqual({ type: 'L', x: 1, y: 0 }); // 100/100 = 1
      expect(result.segments[2]).toEqual({ type: 'L', x: 1, y: 1 });
      expect(result.segments[3]).toEqual({ type: 'L', x: 0, y: 1 });
      expect(result.segments[4]).toEqual({ type: 'Z' });
      expect(result.closed).toBe(true);
    });

    it('normalizes to [0,1] when no target dimensions provided', () => {
      const guides: CustomGuide[] = [];
      const paths: CustomPath[] = [
        {
          width: 200,
          height: 100,
          commands: [
            { type: 'moveTo', x: 100, y: 50 },
            { type: 'lineTo', x: 200, y: 100 },
          ],
        },
      ];
      const result = customGeometryToPath(guides, paths, { width: 200, height: 100 });

      // Normalized: x = 100/200 = 0.5, y = 50/100 = 0.5
      expect(result.segments[0]).toEqual({ type: 'M', x: 0.5, y: 0.5 });
      // x = 200/200 = 1, y = 100/100 = 1
      expect(result.segments[1]).toEqual({ type: 'L', x: 1, y: 1 });
    });

    it('not closed when path does not end with close', () => {
      const paths: CustomPath[] = [
        {
          width: 100,
          height: 100,
          commands: [
            { type: 'moveTo', x: 0, y: 0 },
            { type: 'lineTo', x: 100, y: 100 },
          ],
        },
      ];
      const result = customGeometryToPath([], paths, { width: 100, height: 100 });
      expect(result.closed).toBe(false);
    });
  });

  describe('coordinate scaling', () => {
    it('scales to target dimensions when targetWidth/targetHeight are provided', () => {
      const paths: CustomPath[] = [
        {
          width: 100,
          height: 100,
          commands: [
            { type: 'moveTo', x: 50, y: 50 },
            { type: 'lineTo', x: 100, y: 100 },
          ],
        },
      ];
      const result = customGeometryToPath([], paths, {
        width: 100,
        height: 100,
        targetWidth: 200,
        targetHeight: 400,
      });

      // scaleX = 200/100 = 2, scaleY = 400/100 = 4
      expect(result.segments[0]).toEqual({ type: 'M', x: 100, y: 200 });
      expect(result.segments[1]).toEqual({ type: 'L', x: 200, y: 400 });
    });

    it('uses shapeWidth/shapeHeight when path has no explicit dimensions', () => {
      const paths: CustomPath[] = [
        {
          commands: [
            { type: 'moveTo', x: 50, y: 25 },
            { type: 'lineTo', x: 100, y: 50 },
          ],
        },
      ];
      const result = customGeometryToPath([], paths, { width: 100, height: 50 });

      // pathW defaults to shapeWidth=100, pathH to shapeHeight=50
      // Normalized: 50/100=0.5, 25/50=0.5
      expect(result.segments[0]).toEqual({ type: 'M', x: 0.5, y: 0.5 });
      expect(result.segments[1]).toEqual({ type: 'L', x: 1, y: 1 });
    });

    it('defaults shape dimensions to 1 when no options provided', () => {
      const paths: CustomPath[] = [
        {
          width: 10,
          height: 10,
          commands: [{ type: 'moveTo', x: 5, y: 5 }],
        },
      ];
      const result = customGeometryToPath([], paths);

      // Normalized to [0,1]: 5/10 = 0.5
      expect(result.segments[0]).toEqual({ type: 'M', x: 0.5, y: 0.5 });
    });

    it('handles zero path dimensions gracefully (scaleX/scaleY = 1)', () => {
      const paths: CustomPath[] = [
        {
          width: 0,
          height: 0,
          commands: [{ type: 'moveTo', x: 5, y: 10 }],
        },
      ];
      const result = customGeometryToPath([], paths, { width: 100, height: 100 });

      // pathW=0 -> scaleX=1, pathH=0 -> scaleY=1 (no scaling)
      expect(result.segments[0]).toEqual({ type: 'M', x: 5, y: 10 });
    });
  });

  describe('guide integration', () => {
    it('evaluates guides and uses them in path coordinates', () => {
      const guides: CustomGuide[] = [
        { name: 'halfW', formula: '*/ w 1 2' },
        { name: 'halfH', formula: '*/ h 1 2' },
      ];
      const paths: CustomPath[] = [
        {
          width: 200,
          height: 100,
          commands: [
            { type: 'moveTo', x: 0, y: 0 },
            { type: 'lineTo', x: 100, y: 50 }, // halfway = halfW, halfH in EMUs
          ],
        },
      ];
      const result = customGeometryToPath(guides, paths, { width: 200, height: 100 });

      // Guides are evaluated but path commands use direct numeric values
      // Normalized: 100/200=0.5, 50/100=0.5
      expect(result.segments[1]).toEqual({ type: 'L', x: 0.5, y: 0.5 });
    });
  });

  describe('command types', () => {
    const basePath = (commands: CustomPathCommand[]): CustomPath[] => [
      { width: 100, height: 100, commands },
    ];

    it('handles cubicBezTo', () => {
      const result = customGeometryToPath(
        [],
        basePath([
          { type: 'moveTo', x: 0, y: 0 },
          { type: 'cubicBezTo', x1: 10, y1: 20, x2: 30, y2: 40, x: 50, y: 60 },
        ]),
        { width: 100, height: 100 },
      );

      expect(result.segments[1]).toEqual({
        type: 'C',
        x1: 0.1,
        y1: 0.2,
        x2: 0.3,
        y2: 0.4,
        x: 0.5,
        y: 0.6,
      });
    });

    it('handles quadBezTo', () => {
      const result = customGeometryToPath(
        [],
        basePath([
          { type: 'moveTo', x: 0, y: 0 },
          { type: 'quadBezTo', x1: 50, y1: 100, x: 100, y: 0 },
        ]),
        { width: 100, height: 100 },
      );

      expect(result.segments[1]).toEqual({
        type: 'Q',
        x1: 0.5,
        y1: 1,
        x: 1,
        y: 0,
      });
    });

    it('handles arcTo and approximates with cubic bezier segments', () => {
      const result = customGeometryToPath(
        [],
        basePath([
          { type: 'moveTo', x: 100, y: 50 }, // Start at right edge of ellipse
          { type: 'arcTo', rx: 50, ry: 50, startAngle: 0, sweepAngle: 5400000 }, // 90 degrees
        ]),
        { width: 100, height: 100 },
      );

      // moveTo produces M segment
      expect(result.segments[0].type).toBe('M');
      // arcTo produces at least one C segment
      expect(result.segments.length).toBeGreaterThan(1);
      expect(result.segments[1].type).toBe('C');
    });

    it('arcTo with large sweep produces multiple cubic bezier segments', () => {
      const result = customGeometryToPath(
        [],
        basePath([
          { type: 'moveTo', x: 100, y: 50 },
          // 360 degrees = 21600000 OOXML angle units => should produce 4 segments
          { type: 'arcTo', rx: 50, ry: 50, startAngle: 0, sweepAngle: 21600000 },
        ]),
        { width: 100, height: 100 },
      );

      // M + 4 cubic bezier segments for a full circle
      const cSegments = result.segments.filter((s) => s.type === 'C');
      expect(cSegments.length).toBe(4);
    });
  });

  // ── Multi-path geometry with per-subpath closed tracking ────────────────────

  describe('multi-path geometry', () => {
    it('builds subPaths for compound paths', () => {
      const paths: CustomPath[] = [
        {
          width: 100,
          height: 100,
          commands: [
            { type: 'moveTo', x: 0, y: 0 },
            { type: 'lineTo', x: 100, y: 0 },
            { type: 'close' },
          ],
        },
        {
          width: 100,
          height: 100,
          commands: [
            { type: 'moveTo', x: 10, y: 10 },
            { type: 'lineTo', x: 50, y: 50 },
          ],
        },
      ];
      const result = customGeometryToPath([], paths, { width: 100, height: 100 });

      // All segments are combined
      expect(result.segments).toHaveLength(5); // M, L, Z, M, L

      // subPaths should be split at moveTo boundaries
      expect(result.subPaths).toHaveLength(2);
      // First subpath ends with Z -> closed
      expect(result.subPaths![0].closed).toBe(true);
      expect(result.subPaths![0].segments).toHaveLength(3);
      // Second subpath does not end with Z -> open
      expect(result.subPaths![1].closed).toBe(false);
      expect(result.subPaths![1].segments).toHaveLength(2);
    });

    it('overall closed is determined by last segment', () => {
      const paths: CustomPath[] = [
        {
          width: 100,
          height: 100,
          commands: [
            { type: 'moveTo', x: 0, y: 0 },
            { type: 'lineTo', x: 100, y: 100 },
            { type: 'close' },
          ],
        },
        {
          width: 100,
          height: 100,
          commands: [
            { type: 'moveTo', x: 10, y: 10 },
            { type: 'lineTo', x: 50, y: 50 },
            // No close here
          ],
        },
      ];
      const result = customGeometryToPath([], paths, { width: 100, height: 100 });

      // Last segment is L (from second path), so overall closed = false
      expect(result.closed).toBe(false);
    });

    it('overall closed is true when last segment is close', () => {
      const paths: CustomPath[] = [
        {
          width: 100,
          height: 100,
          commands: [
            { type: 'moveTo', x: 0, y: 0 },
            { type: 'lineTo', x: 100, y: 100 },
            // No close
          ],
        },
        {
          width: 100,
          height: 100,
          commands: [
            { type: 'moveTo', x: 10, y: 10 },
            { type: 'lineTo', x: 50, y: 50 },
            { type: 'close' },
          ],
        },
      ];
      const result = customGeometryToPath([], paths, { width: 100, height: 100 });

      // Last segment is Z, so overall closed = true
      expect(result.closed).toBe(true);
      // But first subpath is open, second is closed
      expect(result.subPaths![0].closed).toBe(false);
      expect(result.subPaths![1].closed).toBe(true);
    });

    it('handles empty paths array', () => {
      const result = customGeometryToPath([], [], { width: 100, height: 100 });
      expect(result.segments).toHaveLength(0);
      expect(result.closed).toBe(false);
      expect(result.subPaths).toHaveLength(0);
    });

    it('handles a single moveTo (no subpath split needed)', () => {
      const paths: CustomPath[] = [
        {
          width: 100,
          height: 100,
          commands: [{ type: 'moveTo', x: 50, y: 50 }],
        },
      ];
      const result = customGeometryToPath([], paths, { width: 100, height: 100 });
      expect(result.subPaths).toHaveLength(1);
      expect(result.subPaths![0].segments).toHaveLength(1);
      expect(result.subPaths![0].closed).toBe(false);
    });
  });
});

// =============================================================================
// parseCustomGeometry
// =============================================================================

describe('parseCustomGeometry', () => {
  it('parses a simple SVG path string', () => {
    const path = parseCustomGeometry('M 0 0 L 100 0 L 100 100 Z');
    expect(path.segments).toHaveLength(4);
    expect(path.segments[0]).toEqual({ type: 'M', x: 0, y: 0 });
    expect(path.segments[1]).toEqual({ type: 'L', x: 100, y: 0 });
    expect(path.segments[2]).toEqual({ type: 'L', x: 100, y: 100 });
    expect(path.segments[3]).toEqual({ type: 'Z' });
    expect(path.closed).toBe(true);
  });

  it('parses a cubic bezier SVG path', () => {
    const path = parseCustomGeometry('M 0 0 C 10 20 30 40 50 60');
    expect(path.segments).toHaveLength(2);
    expect(path.segments[1]).toEqual({
      type: 'C',
      x1: 10,
      y1: 20,
      x2: 30,
      y2: 40,
      x: 50,
      y: 60,
    });
  });

  it('parses a quadratic bezier SVG path', () => {
    const path = parseCustomGeometry('M 0 0 Q 50 100 100 0');
    expect(path.segments).toHaveLength(2);
    expect(path.segments[1]).toEqual({
      type: 'Q',
      x1: 50,
      y1: 100,
      x: 100,
      y: 0,
    });
  });

  it('parses an open path (no Z) as not closed', () => {
    const path = parseCustomGeometry('M 0 0 L 100 100');
    expect(path.closed).toBe(false);
  });

  it('handles compact SVG path (no spaces between commands)', () => {
    const path = parseCustomGeometry('M0 0L100 0L100 100Z');
    expect(path.segments).toHaveLength(4);
    expect(path.closed).toBe(true);
  });

  it('handles negative coordinates', () => {
    const path = parseCustomGeometry('M -10 -20 L 100 -50');
    expect(path.segments[0]).toEqual({ type: 'M', x: -10, y: -20 });
    expect(path.segments[1]).toEqual({ type: 'L', x: 100, y: -50 });
  });

  it('handles decimal coordinates', () => {
    const path = parseCustomGeometry('M 0.5 1.5 L 3.14 2.72');
    expect(path.segments[0]).toEqual({ type: 'M', x: 0.5, y: 1.5 });
    expect(path.segments[1]).toEqual({ type: 'L', x: 3.14, y: 2.72 });
  });
});
