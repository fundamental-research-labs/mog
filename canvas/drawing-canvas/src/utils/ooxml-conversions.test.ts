import {
  contractCropToSourceRect,
  fractionToOoxmlOpacity,
  fractionToSourceRect,
  ooxmlBrightnessToPercent,
  ooxmlContrastToPercent,
  ooxmlOpacityToFraction,
  opacityToTransparency,
  percentToOoxmlBrightness,
  percentToOoxmlContrast,
  sourceRectToContractCrop,
  sourceRectToFraction,
  transparencyToOpacity,
} from './ooxml-conversions';

describe('ooxml-conversions', () => {
  // Source rect / crop
  describe('sourceRectToFraction', () => {
    it('converts 0 to 0', () => {
      expect(sourceRectToFraction(0)).toBe(0);
    });
    it('converts 100000 to 1', () => {
      expect(sourceRectToFraction(100_000)).toBe(1);
    });
    it('converts 50000 to 0.5', () => {
      expect(sourceRectToFraction(50_000)).toBe(0.5);
    });
    it('converts 10000 to 0.1', () => {
      expect(sourceRectToFraction(10_000)).toBeCloseTo(0.1);
    });
  });

  describe('fractionToSourceRect', () => {
    it('converts 0 to 0', () => {
      expect(fractionToSourceRect(0)).toBe(0);
    });
    it('converts 1 to 100000', () => {
      expect(fractionToSourceRect(1)).toBe(100_000);
    });
    it('converts 0.5 to 50000', () => {
      expect(fractionToSourceRect(0.5)).toBe(50_000);
    });
  });

  describe('sourceRectToContractCrop', () => {
    it('converts 0 to 0', () => {
      expect(sourceRectToContractCrop(0)).toBe(0);
    });
    it('converts 100000 to 100', () => {
      expect(sourceRectToContractCrop(100_000)).toBe(100);
    });
    it('converts 50000 to 50', () => {
      expect(sourceRectToContractCrop(50_000)).toBe(50);
    });
  });

  describe('contractCropToSourceRect', () => {
    it('converts 0 to 0', () => {
      expect(contractCropToSourceRect(0)).toBe(0);
    });
    it('converts 100 to 100000', () => {
      expect(contractCropToSourceRect(100)).toBe(100_000);
    });
  });

  // Opacity / transparency
  describe('ooxmlOpacityToFraction', () => {
    it('converts 100000 (fully opaque) to 1', () => {
      expect(ooxmlOpacityToFraction(100_000)).toBe(1);
    });
    it('converts 0 (fully transparent) to 0', () => {
      expect(ooxmlOpacityToFraction(0)).toBe(0);
    });
    it('converts 50000 to 0.5', () => {
      expect(ooxmlOpacityToFraction(50_000)).toBe(0.5);
    });
  });

  describe('fractionToOoxmlOpacity', () => {
    it('converts 1 to 100000', () => {
      expect(fractionToOoxmlOpacity(1)).toBe(100_000);
    });
    it('converts 0 to 0', () => {
      expect(fractionToOoxmlOpacity(0)).toBe(0);
    });
  });

  describe('transparencyToOpacity', () => {
    it('converts 0 (fully opaque) to 1', () => {
      expect(transparencyToOpacity(0)).toBe(1);
    });
    it('converts 100 (fully transparent) to 0', () => {
      expect(transparencyToOpacity(100)).toBe(0);
    });
    it('converts 50 to 0.5', () => {
      expect(transparencyToOpacity(50)).toBe(0.5);
    });
  });

  describe('opacityToTransparency', () => {
    it('converts 1 to 0', () => {
      expect(opacityToTransparency(1)).toBe(0);
    });
    it('converts 0 to 100', () => {
      expect(opacityToTransparency(0)).toBe(100);
    });
    it('converts 0.5 to 50', () => {
      expect(opacityToTransparency(0.5)).toBe(50);
    });
  });

  // Brightness / contrast
  describe('ooxmlBrightnessToPercent', () => {
    it('converts 0 to 0', () => {
      expect(ooxmlBrightnessToPercent(0)).toBe(0);
    });
    it('converts -100000 to -100', () => {
      expect(ooxmlBrightnessToPercent(-100_000)).toBe(-100);
    });
    it('converts 100000 to 100', () => {
      expect(ooxmlBrightnessToPercent(100_000)).toBe(100);
    });
    it('converts -20000 to -20', () => {
      expect(ooxmlBrightnessToPercent(-20_000)).toBe(-20);
    });
  });

  describe('percentToOoxmlBrightness', () => {
    it('converts -20 to -20000', () => {
      expect(percentToOoxmlBrightness(-20)).toBe(-20_000);
    });
    it('converts 0 to 0', () => {
      expect(percentToOoxmlBrightness(0)).toBe(0);
    });
  });

  describe('ooxmlContrastToPercent', () => {
    it('converts 40000 to 40', () => {
      expect(ooxmlContrastToPercent(40_000)).toBe(40);
    });
    it('converts -100000 to -100', () => {
      expect(ooxmlContrastToPercent(-100_000)).toBe(-100);
    });
  });

  describe('percentToOoxmlContrast', () => {
    it('converts 40 to 40000', () => {
      expect(percentToOoxmlContrast(40)).toBe(40_000);
    });
    it('converts 0 to 0', () => {
      expect(percentToOoxmlContrast(0)).toBe(0);
    });
  });
});
