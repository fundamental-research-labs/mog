import {
  createArcPath,
  createBulgePath,
  createCircularArcPath,
  createSinePath,
  pointsToSmoothPath,
} from '../src/warp/path-utils';

describe('createArcPath', () => {
  it('up direction produces negative y control point', () => {
    const path = createArcPath(200, 50, 'up');
    // Q controlX,controlY — controlY should be negative for 'up'
    const match = path.match(/Q\s+([\d.]+),([-\d.]+)/);
    expect(match).not.toBeNull();
    expect(Number(match![2])).toBeLessThan(0);
  });

  it('down direction produces positive y control point', () => {
    const path = createArcPath(200, 50, 'down');
    const match = path.match(/Q\s+([\d.]+),([-\d.]+)/);
    expect(match).not.toBeNull();
    expect(Number(match![2])).toBeGreaterThan(0);
  });

  it('path starts at 0,0 and ends at width,0', () => {
    const path = createArcPath(300, 40, 'up');
    expect(path).toMatch(/^M 0,0/);
    expect(path).toMatch(/300,0$/);
  });
});

describe('createSinePath', () => {
  it('returns smooth path with expected start and end x', () => {
    const path = createSinePath(200, 30, 1);
    expect(path).toMatch(/^M 0,/);
    // Last point should be at x=200
    expect(path).toMatch(/200,/);
  });

  it('frequency controls number of oscillations', () => {
    const path1 = createSinePath(200, 30, 1);
    const path2 = createSinePath(200, 30, 3);
    // More frequency = more curve segments with different control points
    // Both should be valid paths but differ
    expect(path1).not.toEqual(path2);
  });

  it('amplitude controls peak height', () => {
    const smallAmp = createSinePath(200, 10, 1);
    const largeAmp = createSinePath(200, 100, 1);
    // Extract some y values — larger amplitude should produce larger y values
    const getYValues = (path: string) => {
      const matches = [...path.matchAll(/([-\d.]+),([-\d.]+)/g)];
      return matches.map((m) => Math.abs(Number(m[2])));
    };
    const smallMax = Math.max(...getYValues(smallAmp));
    const largeMax = Math.max(...getYValues(largeAmp));
    expect(largeMax).toBeGreaterThan(smallMax);
  });
});

describe('createCircularArcPath', () => {
  it('produces SVG arc command', () => {
    const path = createCircularArcPath(100, Math.PI / 2);
    expect(path).toContain('A');
    expect(path).toMatch(/^M /);
  });

  it('large arc flag set when sweep > PI', () => {
    const smallSweep = createCircularArcPath(100, Math.PI / 2);
    const largeSweep = createCircularArcPath(100, Math.PI * 1.5);
    // Small sweep: largeArc = 0
    expect(smallSweep).toMatch(/A\s+[\d.]+,[\d.]+\s+0\s+0,1/);
    // Large sweep: largeArc = 1
    expect(largeSweep).toMatch(/A\s+[\d.]+,[\d.]+\s+0\s+1,1/);
  });
});

describe('createBulgePath', () => {
  it('center position produces symmetric bulge', () => {
    const path = createBulgePath(200, 50, 'center');
    expect(path).toMatch(/^M 0,/);
    // Should contain curve commands
    expect(path).toContain('C');
  });

  it('left/right positions shift bulge center', () => {
    const left = createBulgePath(200, 50, 'left');
    const right = createBulgePath(200, 50, 'right');
    const center = createBulgePath(200, 50, 'center');
    // All three should be different paths
    expect(left).not.toEqual(right);
    expect(left).not.toEqual(center);
    expect(right).not.toEqual(center);
  });

  it('positive amount = bulge down, negative = bulge up', () => {
    const down = createBulgePath(200, 50);
    const up = createBulgePath(200, -50);
    // Extract y values near the center of the path
    const getMiddleY = (path: string) => {
      const matches = [...path.matchAll(/([-\d.e+]+),([-\d.e+]+)/g)];
      const mid = Math.floor(matches.length / 2);
      return Number(matches[mid][2]);
    };
    expect(getMiddleY(down)).toBeGreaterThan(0);
    expect(getMiddleY(up)).toBeLessThan(0);
  });
});

describe('pointsToSmoothPath', () => {
  it('returns empty string for no points', () => {
    expect(pointsToSmoothPath([])).toBe('');
  });

  it('returns moveTo for single point', () => {
    expect(pointsToSmoothPath([{ x: 5, y: 10 }])).toBe('M 5,10');
  });

  it('two points produce single cubic bezier', () => {
    const path = pointsToSmoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(path).toMatch(/^M 0,0 C /);
    // Should have exactly one C command
    const cCount = (path.match(/ C /g) || []).length;
    expect(cCount).toBe(1);
    // Should end at the second point
    expect(path).toMatch(/10,10$/);
  });

  it('multiple points produce smooth curve with C commands', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: 0 },
      { x: 30, y: 20 },
      { x: 40, y: 0 },
    ];
    const path = pointsToSmoothPath(points);
    const cCount = (path.match(/ C /g) || []).length;
    expect(cCount).toBe(4); // One C per segment after the first point
  });

  it('Catmull-Rom: control points lie between data points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ];
    const path = pointsToSmoothPath(points);
    // All control point x values should be between 0 and 200
    const coords = [...path.matchAll(/([-\d.]+),([-\d.]+)/g)];
    for (const m of coords) {
      const x = Number(m[1]);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(200);
    }
  });
});
