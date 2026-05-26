/**
 * Tests for flowchart shape presets.
 */
import { PathOps } from '@mog/geometry';
import { generateShapePath, isValidShapeType } from '../../src/shape-to-path';

describe('Flowchart Shape Presets', () => {
  const flowchartShapes = [
    'flowChartProcess',
    'flowChartAlternateProcess',
    'flowChartDecision',
    'flowChartInputOutput',
    'flowChartPredefinedProcess',
    'flowChartInternalStorage',
    'flowChartDocument',
    'flowChartMultidocument',
    'flowChartTerminator',
    'flowChartPreparation',
    'flowChartManualInput',
    'flowChartManualOperation',
    'flowChartConnector',
    'flowChartOffpageConnector',
    'flowChartPunchedCard',
    'flowChartPunchedTape',
    'flowChartSummingJunction',
    'flowChartOr',
    'flowChartCollate',
    'flowChartSort',
    'flowChartExtract',
    'flowChartMerge',
    'flowChartOfflineStorage',
    'flowChartOnlineStorage',
    'flowChartMagneticTape',
    'flowChartMagneticDisk',
    'flowChartMagneticDrum',
    'flowChartDisplay',
    'flowChartDelay',
  ];

  it('should register all flowchart shapes', () => {
    for (const shape of flowchartShapes) {
      expect(isValidShapeType(shape)).toBe(true);
    }
  });

  describe.each(flowchartShapes)('%s', (shapeType) => {
    it('should generate a non-empty path', () => {
      const path = generateShapePath(shapeType, 100, 100);
      expect(path.segments.length).toBeGreaterThan(0);
    });

    it('should have no NaN coordinates', () => {
      const path = generateShapePath(shapeType, 100, 100);
      for (const seg of path.segments) {
        if (seg.type === 'Z') continue;
        expect(isNaN(seg.x)).toBe(false);
        expect(isNaN(seg.y)).toBe(false);
      }
    });

    it('should generate snapshot-stable path at 100x100', () => {
      const path = generateShapePath(shapeType, 100, 100);
      expect(path.segments).toMatchSnapshot();
    });
  });

  describe('flowChartProcess', () => {
    it('should be a simple rectangle', () => {
      const path = generateShapePath('flowChartProcess', 100, 50);
      expect(path.closed).toBe(true);
      const bb = PathOps.pathBoundingBox(path);
      expect(bb.width).toBeCloseTo(100);
      expect(bb.height).toBeCloseTo(50);
    });
  });

  describe('flowChartDecision', () => {
    it('should be a diamond shape', () => {
      const path = generateShapePath('flowChartDecision', 100, 100);
      expect(path.closed).toBe(true);
      // Diamond: 4 points
      const lineSegs = path.segments.filter((s) => s.type === 'L');
      expect(lineSegs.length).toBe(3);
    });
  });

  describe('flowChartTerminator', () => {
    it('should have rounded ends (cubic bezier curves)', () => {
      const path = generateShapePath('flowChartTerminator', 100, 40);
      const hasCurves = path.segments.some((s) => s.type === 'C');
      expect(hasCurves).toBe(true);
    });
  });
});
