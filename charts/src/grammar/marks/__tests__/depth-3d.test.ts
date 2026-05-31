import type { ArcMark, PathMark } from '../../../primitives/types';
import {
  arcMarkToPathMark,
  depthEnhanceArcMark,
  depthEnhanceAreaPathMark,
  depthEnhanceLinePathMark,
} from '../depth-3d';

describe('depth-3d mark helpers', () => {
  const lineMark: PathMark = {
    type: 'path',
    x: 0,
    y: 0,
    path: 'M10,20 L30,40',
    datum: [{ series: 'A' }],
    style: {
      stroke: '#6699cc',
      strokeWidth: 2,
      opacity: 1,
    },
  };

  it('creates a back line, endpoint connectors, and the original top line', () => {
    const marks = depthEnhanceLinePathMark(lineMark, { depthX: 4, depthY: 6 });

    expect(marks).toHaveLength(4);
    expect(marks[0].path).toBe('M14,26 L34,46');
    expect(marks[1].path).toBe('M10,20 L14,26');
    expect(marks[2].path).toBe('M30,40 L34,46');
    expect(marks[3]).toBe(lineMark);
    expect(marks[0].style.stroke).toBe('#386b9e');
  });

  it('creates side faces around a closed area path', () => {
    const areaMark: PathMark = {
      type: 'path',
      x: 0,
      y: 0,
      path: 'M0,10 L0,0 L10,0 L10,10 Z',
      datum: [{ series: 'A' }],
      style: {
        fill: '#99cc66',
        stroke: '#669944',
        strokeWidth: 1,
        opacity: 0.8,
      },
    };

    const marks = depthEnhanceAreaPathMark(areaMark, { depthX: 2, depthY: 3 });

    expect(marks).toHaveLength(6);
    expect(marks[0].path).toBe('M2,13 L2,3 L12,3 L12,13 Z');
    expect(marks[1].path).toBe('M0,10 L0,0 L2,3 L2,13 Z');
    expect(marks[5]).toBe(areaMark);
    expect(marks[1].style.fill).toBe('#6b9e38');
    expect(marks[1].style.opacity).toBeCloseTo(0.576);
  });

  it('turns an arc mark into path-only depth faces and a top slice', () => {
    const arcMark: ArcMark = {
      type: 'arc',
      x: 50,
      y: 50,
      innerRadius: 20,
      outerRadius: 40,
      startAngle: 0,
      endAngle: Math.PI / 2,
      datum: { label: 'A' },
      style: {
        fill: '#cc6666',
        stroke: '#ffffff',
        strokeWidth: 1,
      },
    };

    const marks = depthEnhanceArcMark(arcMark, { depthX: 5, depthY: 7 });

    expect(marks).toHaveLength(5);
    expect(marks.every((mark) => mark.type === 'path')).toBe(true);
    expect(marks[0].path).toContain('A40,40 0 0 1 90,50');
    expect(marks[4].path).toBe('M50,10 A40,40 0 0 1 90,50 L70,50 A20,20 0 0 0 50,30 Z');
  });

  it('can return only depth faces when includeTop is false', () => {
    const marks = depthEnhanceLinePathMark(lineMark, { includeTop: false });

    expect(marks).toHaveLength(3);
    expect(marks).not.toContain(lineMark);
  });

  it('converts a standalone arc mark to a top path mark', () => {
    const pathMark = arcMarkToPathMark({
      type: 'arc',
      x: 10,
      y: 20,
      innerRadius: 0,
      outerRadius: 5,
      startAngle: 0,
      endAngle: Math.PI,
      datum: null,
      style: { fill: '#000000' },
    });

    expect(pathMark?.path).toBe('M10,20 L10,15 A5,5 0 0 1 10,25 Z');
  });
});
