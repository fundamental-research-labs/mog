/**
 * Tests for the font pipeline integration between PdfCanvas and IpcBridge.
 *
 * Verifies:
 * - PdfCanvas.measureTextAsync() delegates to bridge when supportsRealFonts
 * - PdfCanvas.measureTextAsync() falls back to AFM when !supportsRealFonts
 * - PdfCanvas.bridge accessor exposes the underlying bridge
 * - End-to-end font registration + measurement flow
 */

import { MockIpcBridge, TauriFontBridge } from '../ipc-bridge';
import { PdfCanvas } from '../pdf-canvas';
import { createScaffoldFont, measureTextWidth } from '../text/afm-metrics';
import type { FontHandle } from '../types';

describe('PdfCanvas font pipeline', () => {
  describe('bridge accessor', () => {
    it('exposes the underlying IpcBridge', () => {
      const bridge = new MockIpcBridge();
      const canvas = new PdfCanvas(bridge);
      expect(canvas.bridge).toBe(bridge);
    });
  });

  describe('measureTextAsync with MockIpcBridge', () => {
    let bridge: MockIpcBridge;
    let canvas: PdfCanvas;

    beforeEach(() => {
      bridge = new MockIpcBridge();
      canvas = new PdfCanvas(bridge);
    });

    it('falls back to AFM scaffold metrics', async () => {
      const font = createScaffoldFont();
      const asyncWidth = await canvas.measureTextAsync('Hello', font, 12);
      const syncWidth = canvas.measureText('Hello', font, 12);

      expect(asyncWidth).toBe(syncWidth);
    });

    it('returns 0 for empty string', async () => {
      const font = createScaffoldFont();
      const width = await canvas.measureTextAsync('', font, 12);
      expect(width).toBe(0);
    });

    it('matches synchronous measureText exactly', async () => {
      const font = createScaffoldFont('helvetica', 'bold');
      const texts = ['Hello World', 'ABC 123', 'Test!', ''];

      for (const text of texts) {
        const asyncW = await canvas.measureTextAsync(text, font, 14);
        const syncW = canvas.measureText(text, font, 14);
        expect(asyncW).toBe(syncW);
      }
    });
  });

  describe('measureTextAsync with TauriFontBridge', () => {
    it('delegates to Rust via bridge.measureText', async () => {
      const mockInvoke = jest.fn().mockResolvedValue(55.25);
      const bridge = new TauriFontBridge(mockInvoke);
      const canvas = new PdfCanvas(bridge);

      const handle: FontHandle = {
        id: 'rust-font-1',
        family: 'Calibri',
        weight: 'normal',
        style: 'normal',
      };

      const width = await canvas.measureTextAsync('Hello', handle, 12);

      expect(width).toBe(55.25);
      expect(mockInvoke).toHaveBeenCalledWith('pdf_measure_text', {
        fontId: 'rust-font-1',
        text: 'Hello',
        size: 12,
      });
    });

    it('does NOT fall back to AFM when bridge supports real fonts', async () => {
      // Return a very different width than AFM would produce
      const mockInvoke = jest.fn().mockResolvedValue(999.99);
      const bridge = new TauriFontBridge(mockInvoke);
      const canvas = new PdfCanvas(bridge);

      const font = createScaffoldFont();
      const width = await canvas.measureTextAsync('X', font, 12);

      // Should use the Rust value, not AFM
      expect(width).toBe(999.99);
    });
  });

  describe('synchronous measureText is unchanged', () => {
    it('always uses AFM regardless of bridge type', () => {
      const mockInvoke = jest.fn();
      const bridge = new TauriFontBridge(mockInvoke);
      const canvas = new PdfCanvas(bridge);

      const font = createScaffoldFont();
      const width = canvas.measureText('Hello', font, 12);

      // Should use AFM, not invoke Rust
      expect(mockInvoke).not.toHaveBeenCalled();
      expect(width).toBe(measureTextWidth('Hello', font, 12));
    });
  });

  describe('end-to-end font registration flow', () => {
    it('register font, measure text, finalize', async () => {
      const bridge = new MockIpcBridge();
      const canvas = new PdfCanvas(bridge);

      // 1. Register a font
      const fontData = new Uint8Array([0x00, 0x01, 0x00, 0x00]);
      const handle = await bridge.registerFont(fontData, 'TestFont');
      expect(handle.id).toBe('mock-font-1');

      // 2. Set font on canvas
      canvas.setFont(handle, 12);

      // 3. Measure text (async path — uses AFM fallback in mock)
      const width = await canvas.measureTextAsync('Hello', handle, 12);
      expect(width).toBeGreaterThan(0);

      // 4. Draw text
      canvas.beginPage(612, 792);
      canvas.drawText('Hello', 100, 100, {});
      await canvas.endPage();

      // 5. Finalize fonts
      const resources = await bridge.finalizeFonts();
      expect(resources.size).toBe(1);
      expect(resources.get('mock-font-1')).toBeDefined();

      // 6. Verify ops were written
      const ops = bridge.getOps(0);
      expect(ops.length).toBeGreaterThan(0);
      expect(ops.some((o) => o.op === 'ShowText')).toBe(true);
    });

    it('register multiple fonts and finalize', async () => {
      const bridge = new MockIpcBridge();

      const h1 = await bridge.registerFont(new Uint8Array([0x01]), 'Font1');
      const h2 = await bridge.registerFont(new Uint8Array([0x02]), 'Font2');
      const h3 = await bridge.registerFont(new Uint8Array([0x03]), 'Font3');

      const resources = await bridge.finalizeFonts();
      expect(resources.size).toBe(3);

      // Resource names should be sequential
      expect(resources.get(h1.id)!.resourceName).toBe('/F1');
      expect(resources.get(h2.id)!.resourceName).toBe('/F2');
      expect(resources.get(h3.id)!.resourceName).toBe('/F3');
    });
  });
});
