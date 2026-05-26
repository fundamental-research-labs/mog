/**
 * Tests for Tooltip - arc mark position calculation
 */

import { getMarkPosition } from '../src/interaction/tooltip';
import { getArcCentroid } from '../src/primitives/marks/arc';
import type { ArcMark } from '../src/primitives/types';

describe('getMarkPosition for arc marks', () => {
  function makeArc(startAngle: number, endAngle: number): ArcMark {
    return {
      type: 'arc',
      x: 200,
      y: 200,
      innerRadius: 0,
      outerRadius: 100,
      startAngle,
      endAngle,
      style: { fill: '#4e79a7' },
    };
  }

  it('matches getArcCentroid for arc at 0 (top / 12 o clock)', () => {
    // Arc spanning from -PI/4 to PI/4, centered at top
    const arc = makeArc(-Math.PI / 4, Math.PI / 4);
    const tooltipPos = getMarkPosition(arc);
    const centroid = getArcCentroid(arc);
    expect(tooltipPos.x).toBeCloseTo(centroid.x, 5);
    expect(tooltipPos.y).toBeCloseTo(centroid.y, 5);
  });

  it('matches getArcCentroid for arc at PI/2 (right / 3 o clock)', () => {
    const arc = makeArc(Math.PI / 4, (3 * Math.PI) / 4);
    const tooltipPos = getMarkPosition(arc);
    const centroid = getArcCentroid(arc);
    expect(tooltipPos.x).toBeCloseTo(centroid.x, 5);
    expect(tooltipPos.y).toBeCloseTo(centroid.y, 5);
  });

  it('matches getArcCentroid for arc at PI (bottom / 6 o clock)', () => {
    const arc = makeArc((3 * Math.PI) / 4, (5 * Math.PI) / 4);
    const tooltipPos = getMarkPosition(arc);
    const centroid = getArcCentroid(arc);
    expect(tooltipPos.x).toBeCloseTo(centroid.x, 5);
    expect(tooltipPos.y).toBeCloseTo(centroid.y, 5);
  });

  it('matches getArcCentroid for arc at 3PI/2 (left / 9 o clock)', () => {
    const arc = makeArc((5 * Math.PI) / 4, (7 * Math.PI) / 4);
    const tooltipPos = getMarkPosition(arc);
    const centroid = getArcCentroid(arc);
    expect(tooltipPos.x).toBeCloseTo(centroid.x, 5);
    expect(tooltipPos.y).toBeCloseTo(centroid.y, 5);
  });

  it('applies -PI/2 offset correctly: top arc should have y < center', () => {
    // Arc centered at top (midAngle = 0, which means 12 o clock)
    // With the offset, cos(-PI/2) = 0, sin(-PI/2) = -1
    // So x should be near center, y should be above center
    const arc = makeArc(-Math.PI / 8, Math.PI / 8);
    const pos = getMarkPosition(arc);
    // y should be less than center (200) because arc points up
    expect(pos.y).toBeLessThan(arc.y);
    // x should be close to center
    expect(pos.x).toBeCloseTo(arc.x, 0);
  });

  it('applies -PI/2 offset correctly: right arc should have x > center', () => {
    // Arc centered at right (midAngle = PI/2)
    // With offset: cos(PI/2 - PI/2) = cos(0) = 1
    // So x should be to the right of center
    const arc = makeArc(Math.PI / 2 - Math.PI / 8, Math.PI / 2 + Math.PI / 8);
    const pos = getMarkPosition(arc);
    // x should be greater than center (200)
    expect(pos.x).toBeGreaterThan(arc.x);
  });

  it('works for doughnut arcs (innerRadius > 0)', () => {
    const arc: ArcMark = {
      type: 'arc',
      x: 200,
      y: 200,
      innerRadius: 50,
      outerRadius: 100,
      startAngle: 0,
      endAngle: Math.PI / 2,
      style: { fill: '#4e79a7' },
    };
    const tooltipPos = getMarkPosition(arc);
    const centroid = getArcCentroid(arc);
    expect(tooltipPos.x).toBeCloseTo(centroid.x, 5);
    expect(tooltipPos.y).toBeCloseTo(centroid.y, 5);
  });
});
