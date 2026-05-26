/**
 * Tests for shape diagnostic reporters.
 */
import { generatePresetSummaryReport, generateShapeReport } from '../../src/diagnostics/reporters';
import { getRegisteredShapeTypes } from '../../src/shape-to-path';

// Ensure all presets are registered by importing through shape-to-path
// (which itself imports all preset modules)
import '../../src/presets/basic';

describe('generateShapeReport', () => {
  describe('valid shape type', () => {
    it('should include the shape type name in the header', () => {
      const report = generateShapeReport('rect');
      expect(report).toContain('Shape Report: rect');
    });

    it('should include a separator line', () => {
      const report = generateShapeReport('rect');
      expect(report).toContain('='.repeat(40));
    });

    it('should include validation result as PASS for a valid shape', () => {
      const report = generateShapeReport('rect');
      expect(report).toContain('Validation: PASS');
    });

    it('should include geometry section for a valid shape', () => {
      const report = generateShapeReport('rect');
      expect(report).toContain('Geometry:');
      expect(report).toContain('Path length:');
      expect(report).toContain('Point count:');
      expect(report).toContain('Bounding box:');
    });

    it('should report default adjustments for shapes that have them', () => {
      const report = generateShapeReport('roundRect');
      expect(report).toContain('Default Adjustments (1):');
      expect(report).toContain('adj');
    });

    it('should report zero default adjustments for shapes without them', () => {
      const report = generateShapeReport('rect');
      expect(report).toContain('Default Adjustments (0):');
    });

    it('should include adjustment value in report', () => {
      const report = generateShapeReport('roundRect');
      // OOXML roundRect adj has default value 16667 with no explicit min/max
      expect(report).toContain('adj');
      expect(report).toContain('16667');
    });

    it('should report geometry path length as a positive number', () => {
      const report = generateShapeReport('ellipse');
      // Extract path length value from the report
      const match = report.match(/Path length: ([\d.]+)/);
      expect(match).not.toBeNull();
      expect(parseFloat(match![1])).toBeGreaterThan(0);
    });

    it('should report geometry point count as a positive integer', () => {
      const report = generateShapeReport('triangle');
      const match = report.match(/Point count: (\d+)/);
      expect(match).not.toBeNull();
      expect(parseInt(match![1], 10)).toBeGreaterThan(0);
    });

    it('should include bounding box coordinates', () => {
      const report = generateShapeReport('rect');
      // Bounding box for a 100x100 rectangle at default size should be (0.0, 0.0) 100.0x100.0
      expect(report).toMatch(/Bounding box: \([\d.]+, [\d.]+\) [\d.]+x[\d.]+/);
    });
  });

  describe('unknown/invalid shape type', () => {
    it('should report an error for an unknown shape type', () => {
      const report = generateShapeReport('totallyFakeShape');
      expect(report).toContain('ERROR: Shape type "totallyFakeShape" is not registered.');
    });

    it('should include the shape type name in the header even for unknown types', () => {
      const report = generateShapeReport('nonExistent');
      expect(report).toContain('Shape Report: nonExistent');
    });

    it('should report total available types for unknown shape', () => {
      const report = generateShapeReport('nonExistent');
      expect(report).toContain('Available types:');
      expect(report).toMatch(/Available types: \d+ total/);
    });

    it('should not include Geometry section for unknown shapes', () => {
      const report = generateShapeReport('nonExistent');
      expect(report).not.toContain('Geometry:');
    });

    it('should not include Default Adjustments section for unknown shapes', () => {
      const report = generateShapeReport('nonExistent');
      expect(report).not.toContain('Default Adjustments');
    });

    it('should not include Validation section for unknown shapes', () => {
      const report = generateShapeReport('nonExistent');
      // The report returns early after the error, so no Validation line
      expect(report).not.toContain('Validation:');
    });
  });

  describe('shape with validation issues', () => {
    it('should report FAIL validation when adjustments are out of bounds', () => {
      const report = generateShapeReport('roundRect', [
        { name: 'adj', value: NaN, min: 0, max: 50000 },
      ]);
      expect(report).toContain('Validation: FAIL');
    });

    it('should include issue severity and code for NaN adjustments', () => {
      const report = generateShapeReport('roundRect', [
        { name: 'adj', value: NaN, min: 0, max: 50000 },
      ]);
      expect(report).toContain('[ERROR] SHAPE_ADJUSTMENT_NAN');
    });

    it('should include warning for out-of-bounds adjustment', () => {
      const report = generateShapeReport('roundRect', [
        { name: 'adj', value: 90000, min: 0, max: 50000 },
      ]);
      expect(report).toContain('[WARNING] SHAPE_ADJUSTMENT_OOB');
    });

    it('should still include geometry section even with warnings', () => {
      const report = generateShapeReport('roundRect', [
        { name: 'adj', value: 90000, min: 0, max: 50000 },
      ]);
      // Warnings do not prevent geometry generation
      expect(report).toContain('Geometry:');
    });

    it('should show PASS when only warnings are present (no errors)', () => {
      const report = generateShapeReport('roundRect', [
        { name: 'adj', value: 90000, min: 0, max: 50000 },
      ]);
      expect(report).toContain('Validation: PASS');
    });
  });

  describe('custom adjustments override defaults', () => {
    it('should use provided adjustments for validation', () => {
      const report = generateShapeReport('hexagon', [
        { name: 'adjust', value: 0.3, min: 0, max: 0.5 },
      ]);
      expect(report).toContain('Validation: PASS');
      expect(report).toContain('Geometry:');
    });
  });
});

describe('generatePresetSummaryReport', () => {
  describe('report structure', () => {
    it('should include the title', () => {
      const report = generatePresetSummaryReport();
      expect(report).toContain('Shape Engine Preset Summary');
    });

    it('should include a separator line', () => {
      const report = generatePresetSummaryReport();
      expect(report).toContain('='.repeat(40));
    });
  });

  describe('total count', () => {
    it('should report the correct total number of registered presets', () => {
      const report = generatePresetSummaryReport();
      const types = getRegisteredShapeTypes();
      expect(report).toContain(`Total registered presets: ${types.length}`);
    });

    it('should have at least one registered preset', () => {
      const report = generatePresetSummaryReport();
      const match = report.match(/Total registered presets: (\d+)/);
      expect(match).not.toBeNull();
      expect(parseInt(match![1], 10)).toBeGreaterThan(0);
    });
  });

  describe('validation counts', () => {
    it('should report the valid count as a fraction of total', () => {
      const report = generatePresetSummaryReport();
      const types = getRegisteredShapeTypes();
      // The report has a line like "Valid: N/M"
      expect(report).toMatch(new RegExp(`Valid: \\d+/${types.length}`));
    });

    it('should have valid + issues equal to total', () => {
      const report = generatePresetSummaryReport();
      const types = getRegisteredShapeTypes();

      const validMatch = report.match(/Valid: (\d+)\/\d+/);
      expect(validMatch).not.toBeNull();
      const validCount = parseInt(validMatch![1], 10);

      const issuesMatch = report.match(/Issues: (\d+)\/\d+/);
      const issueCount = issuesMatch ? parseInt(issuesMatch![1], 10) : 0;

      expect(validCount + issueCount).toBe(types.length);
    });
  });

  describe('failure reporting', () => {
    it('should list failing presets with FAIL prefix if any exist', () => {
      const report = generatePresetSummaryReport();
      const failLines = report.split('\n').filter((line) => line.includes('FAIL:'));
      // If there are failure lines, each should have the expected format
      for (const line of failLines) {
        expect(line).toMatch(/FAIL: \S+ - \S+/);
      }
    });

    it('should not include Issues line when all presets are valid', () => {
      const report = generatePresetSummaryReport();
      const types = getRegisteredShapeTypes();
      const validMatch = report.match(/Valid: (\d+)\/\d+/);
      const validCount = parseInt(validMatch![1], 10);

      if (validCount === types.length) {
        expect(report).not.toContain('Issues:');
      }
    });

    it('should include Issues line when some presets fail validation', () => {
      const report = generatePresetSummaryReport();
      const failLines = report.split('\n').filter((line) => line.includes('FAIL:'));

      if (failLines.length > 0) {
        expect(report).toContain('Issues:');
        expect(report).toMatch(new RegExp(`Issues: ${failLines.length}/\\d+`));
      }
    });
  });

  describe('all presets validate successfully', () => {
    it('should validate every registered preset at 100x100 without errors', () => {
      const report = generatePresetSummaryReport();
      const types = getRegisteredShapeTypes();
      const validMatch = report.match(/Valid: (\d+)\/(\d+)/);
      expect(validMatch).not.toBeNull();
      const validCount = parseInt(validMatch![1], 10);
      const total = parseInt(validMatch![2], 10);
      // All presets should pass validation at default 100x100 size
      expect(validCount).toBe(total);
      expect(validCount).toBe(types.length);
    });
  });
});
