import { MockIpcBridge, TauriFontBridge } from '../ipc-bridge';
import { createScaffoldFont, measureTextWidth } from '../text/afm-metrics';
import type { FontHandle } from '../types';

describe('MockIpcBridge', () => {
  let bridge: MockIpcBridge;

  beforeEach(() => {
    bridge = new MockIpcBridge();
  });

  // ── Existing writeContentOps behavior ─────────────────────────────

  describe('writeContentOps', () => {
    it('captures ops by page index', async () => {
      await bridge.writeContentOps(0, [{ op: 'Fill' }]);
      await bridge.writeContentOps(1, [{ op: 'Stroke' }]);

      expect(bridge.getOps(0)).toEqual([{ op: 'Fill' }]);
      expect(bridge.getOps(1)).toEqual([{ op: 'Stroke' }]);
    });

    it('appends ops for the same page', async () => {
      await bridge.writeContentOps(0, [{ op: 'Fill' }]);
      await bridge.writeContentOps(0, [{ op: 'Stroke' }]);

      expect(bridge.getOps(0)).toEqual([{ op: 'Fill' }, { op: 'Stroke' }]);
    });

    it('returns empty array for unknown page', () => {
      expect(bridge.getOps(99)).toEqual([]);
    });

    it('getAllOps flattens all pages', async () => {
      await bridge.writeContentOps(0, [{ op: 'Fill' }]);
      await bridge.writeContentOps(1, [{ op: 'Stroke' }]);

      const all = bridge.getAllOps();
      expect(all).toEqual([{ op: 'Fill' }, { op: 'Stroke' }]);
    });
  });

  // ── supportsRealFonts ─────────────────────────────────────────────

  describe('supportsRealFonts', () => {
    it('returns false for MockIpcBridge', () => {
      expect(bridge.supportsRealFonts).toBe(false);
    });
  });

  // ── registerFont ──────────────────────────────────────────────────

  describe('registerFont', () => {
    it('returns a FontHandle with unique ID', async () => {
      const data = new Uint8Array([0x00, 0x01, 0x00, 0x00]);
      const handle = await bridge.registerFont(data, 'TestFont');

      expect(handle.id).toBe('mock-font-1');
      expect(handle.family).toBe('TestFont');
      expect(handle.weight).toBe('normal');
      expect(handle.style).toBe('normal');
    });

    it('increments IDs for multiple registrations', async () => {
      const data = new Uint8Array([0x00]);
      const h1 = await bridge.registerFont(data, 'Font1');
      const h2 = await bridge.registerFont(data, 'Font2');

      expect(h1.id).toBe('mock-font-1');
      expect(h2.id).toBe('mock-font-2');
    });

    it('stores font data for inspection', async () => {
      const data = new Uint8Array([0xaa, 0xbb, 0xcc]);
      await bridge.registerFont(data, 'InspectMe');

      expect(bridge.registeredFonts.size).toBe(1);
      const entry = bridge.registeredFonts.get('mock-font-1');
      expect(entry).toBeDefined();
      expect(entry!.fontName).toBe('InspectMe');
      expect(entry!.data).toEqual(data);
    });
  });

  // ── measureText (AFM fallback) ────────────────────────────────────

  describe('measureText', () => {
    it('falls back to AFM scaffold metrics', async () => {
      const font = createScaffoldFont();
      const width = await bridge.measureText(font, 'Hello', 12);
      const expected = measureTextWidth('Hello', font, 12);

      expect(width).toBe(expected);
    });

    it('returns 0 for empty string', async () => {
      const font = createScaffoldFont();
      const width = await bridge.measureText(font, '', 12);
      expect(width).toBe(0);
    });

    it('scales with font size', async () => {
      const font = createScaffoldFont();
      const w12 = await bridge.measureText(font, 'Test', 12);
      const w24 = await bridge.measureText(font, 'Test', 24);
      expect(w24).toBeCloseTo(w12 * 2, 5);
    });

    it('uses bold widths for bold font', async () => {
      const normal = createScaffoldFont('helvetica', 'normal');
      const bold = createScaffoldFont('helvetica', 'bold');

      const wNormal = await bridge.measureText(normal, 'Hello', 12);
      const wBold = await bridge.measureText(bold, 'Hello', 12);

      // Bold Helvetica has different widths than normal
      expect(wBold).not.toBe(wNormal);
    });
  });

  // ── finalizeFonts ─────────────────────────────────────────────────

  describe('finalizeFonts', () => {
    it('returns empty map when no fonts registered', async () => {
      const result = await bridge.finalizeFonts();
      expect(result.size).toBe(0);
    });

    it('returns resource info for each registered font', async () => {
      const data = new Uint8Array([0x00]);
      await bridge.registerFont(data, 'Font1');
      await bridge.registerFont(data, 'Font2');

      const result = await bridge.finalizeFonts();
      expect(result.size).toBe(2);

      const f1 = result.get('mock-font-1');
      expect(f1).toBeDefined();
      expect(f1!.type0Ref).toBe(100);
      expect(f1!.resourceName).toBe('/F1');

      const f2 = result.get('mock-font-2');
      expect(f2).toBeDefined();
      expect(f2!.type0Ref).toBe(101);
      expect(f2!.resourceName).toBe('/F2');
    });
  });

  // ── clear ─────────────────────────────────────────────────────────

  describe('clear', () => {
    it('clears pages, registered fonts, and resets ID counter', async () => {
      const data = new Uint8Array([0x00]);
      await bridge.writeContentOps(0, [{ op: 'Fill' }]);
      await bridge.registerFont(data, 'Font1');

      bridge.clear();

      expect(bridge.pages.size).toBe(0);
      expect(bridge.registeredFonts.size).toBe(0);

      // ID counter should be reset
      const handle = await bridge.registerFont(data, 'AfterClear');
      expect(handle.id).toBe('mock-font-1');
    });
  });
});

describe('TauriFontBridge', () => {
  describe('supportsRealFonts', () => {
    it('returns true', () => {
      const mockInvoke = jest.fn().mockResolvedValue(undefined);
      const bridge = new TauriFontBridge(mockInvoke);
      expect(bridge.supportsRealFonts).toBe(true);
    });
  });

  describe('writeContentOps', () => {
    it('delegates to invoke with correct command', async () => {
      const mockInvoke = jest.fn().mockResolvedValue(undefined);
      const bridge = new TauriFontBridge(mockInvoke);

      await bridge.writeContentOps(0, [{ op: 'Fill' }]);

      expect(mockInvoke).toHaveBeenCalledWith('pdf_write_content_ops', {
        pageIndex: 0,
        ops: [{ op: 'Fill' }],
      });
    });
  });

  describe('registerFont', () => {
    it('delegates to invoke and returns FontHandle', async () => {
      const mockInvoke = jest.fn().mockResolvedValue({
        id: 'rust-font-42',
        family: 'Calibri',
        weight: 'normal',
        style: 'normal',
      });
      const bridge = new TauriFontBridge(mockInvoke);

      const data = new Uint8Array([0x00, 0x01, 0x00, 0x00]);
      const handle = await bridge.registerFont(data, 'Calibri');

      expect(mockInvoke).toHaveBeenCalledWith('pdf_register_font', {
        fontData: [0x00, 0x01, 0x00, 0x00],
        fontName: 'Calibri',
      });
      expect(handle.id).toBe('rust-font-42');
      expect(handle.family).toBe('Calibri');
      expect(handle.weight).toBe('normal');
      expect(handle.style).toBe('normal');
    });

    it('maps bold weight from Rust response', async () => {
      const mockInvoke = jest.fn().mockResolvedValue({
        id: 'rust-font-43',
        family: 'Calibri',
        weight: 'bold',
        style: 'italic',
      });
      const bridge = new TauriFontBridge(mockInvoke);

      const handle = await bridge.registerFont(new Uint8Array([0x00]), 'Calibri-Bold');
      expect(handle.weight).toBe('bold');
      expect(handle.style).toBe('italic');
    });
  });

  describe('measureText', () => {
    it('delegates to invoke and returns width', async () => {
      const mockInvoke = jest.fn().mockResolvedValue(42.5);
      const bridge = new TauriFontBridge(mockInvoke);

      const handle: FontHandle = {
        id: 'rust-font-1',
        family: 'Calibri',
        weight: 'normal',
        style: 'normal',
      };

      const width = await bridge.measureText(handle, 'Hello', 12);

      expect(mockInvoke).toHaveBeenCalledWith('pdf_measure_text', {
        fontId: 'rust-font-1',
        text: 'Hello',
        size: 12,
      });
      expect(width).toBe(42.5);
    });
  });

  describe('finalizeFonts', () => {
    it('delegates to invoke and returns Map', async () => {
      const mockInvoke = jest.fn().mockResolvedValue({
        'rust-font-1': { type0Ref: 10, resourceName: '/F1' },
        'rust-font-2': { type0Ref: 11, resourceName: '/F2' },
      });
      const bridge = new TauriFontBridge(mockInvoke);

      const result = await bridge.finalizeFonts();

      expect(mockInvoke).toHaveBeenCalledWith('pdf_finalize_fonts');
      expect(result.size).toBe(2);
      expect(result.get('rust-font-1')).toEqual({ type0Ref: 10, resourceName: '/F1' });
      expect(result.get('rust-font-2')).toEqual({ type0Ref: 11, resourceName: '/F2' });
    });

    it('returns empty map when no fonts', async () => {
      const mockInvoke = jest.fn().mockResolvedValue({});
      const bridge = new TauriFontBridge(mockInvoke);

      const result = await bridge.finalizeFonts();
      expect(result.size).toBe(0);
    });
  });

  describe('default invoke (no Tauri runtime)', () => {
    it('throws when Tauri is not available', async () => {
      const bridge = new TauriFontBridge(); // no inject
      await expect(bridge.writeContentOps(0, [])).rejects.toThrow(
        'TauriFontBridge: Tauri runtime not available',
      );
    });
  });
});
