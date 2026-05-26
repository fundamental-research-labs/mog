/**
 * IpcBridge — abstraction over Tauri IPC for PDF content stream delivery
 * and font pipeline operations.
 *
 * PdfCanvas builds a buffer of ContentOp objects per page, then flushes them
 * to the Rust pdf-core via this interface. Font operations delegate to the
 * Rust FontRegistry for real TrueType metrics.
 *
 * The interface is mockable for testing without a Tauri runtime.
 */

import type { ContentOp } from './content-ops';
import { measureTextWidth as afmMeasureTextWidth } from './text/afm-metrics';
import type { FontHandle } from './types';

// ── Font Pipeline Types ──────────────────────────────────────────────────

/**
 * Result from finalizing fonts — maps font IDs to their PDF resource info.
 * Each entry describes a Type0/CIDFont resource ready for embedding.
 */
export interface FinalizedFont {
  /** PDF indirect object reference number for the Type0 font. */
  type0Ref: number;
  /** Resource name used in page content streams (e.g., "/F1"). */
  resourceName: string;
}

// ── IpcBridge Interface ──────────────────────────────────────────────────

/**
 * Bridge interface for sending content operations and font commands
 * to the Rust PDF backend.
 *
 * In production, this connects to Rust via Tauri's invoke() mechanism.
 * In tests, a mock implementation captures the ops for assertion and
 * uses AFM scaffold metrics for text measurement.
 */
export interface IpcBridge {
  /**
   * Write a batch of content stream operators for the given page.
   * Called once at endPage() to flush the command buffer.
   */
  writeContentOps(pageIndex: number, ops: ContentOp[]): Promise<void>;

  // ── Font Pipeline Operations ──────────────────────────────────────

  /**
   * Register a TrueType/OpenType font with the Rust font registry.
   *
   * Sends the raw font binary to Rust, which parses it and creates an
   * internal FontRegistry entry. Returns a FontHandle that can be used
   * for subsequent measureText() calls.
   *
   * @param fontData - Raw font file bytes (TTF/OTF)
   * @param fontName - Logical name for the font (e.g., "Calibri")
   * @returns FontHandle with a unique ID assigned by the registry
   */
  registerFont(fontData: Uint8Array, fontName: string): Promise<FontHandle>;

  /**
   * Measure the width of a text string using the registered font's
   * real TrueType metrics (glyph advances + kerning).
   *
   * @param fontHandle - Handle returned from registerFont()
   * @param text - The string to measure
   * @param size - Font size in points
   * @returns Width in points
   */
  measureText(fontHandle: FontHandle, text: string, size: number): Promise<number>;

  /**
   * Finalize all registered fonts — subset, build CIDFont/Type0 objects,
   * and generate ToUnicode CMaps.
   *
   * Call this after all text has been laid out and all codepoints have
   * been added. Returns a map of font ID -> PDF resource info.
   *
   * @returns Map from font ID to finalized font resource info
   */
  finalizeFonts(): Promise<Map<string, FinalizedFont>>;

  // ── Capability Detection ──────────────────────────────────────────

  /**
   * Whether this bridge supports real font metrics from Rust.
   *
   * When false, callers should fall back to the AFM scaffold metrics.
   * MockIpcBridge returns false; TauriFontBridge returns true.
   */
  readonly supportsRealFonts: boolean;
}

// ── MockIpcBridge ────────────────────────────────────────────────────────

/**
 * Mock IpcBridge that captures all written ops for test assertions.
 *
 * Font operations use the AFM scaffold metrics as a fallback, so all
 * existing tests continue to produce the same measurements without
 * a Rust runtime.
 */
export class MockIpcBridge implements IpcBridge {
  /** All ops written, keyed by page index. */
  readonly pages: Map<number, ContentOp[]> = new Map();

  /** Registered fonts (for test inspection). */
  readonly registeredFonts: Map<string, { fontName: string; data: Uint8Array }> = new Map();

  /** Counter for generating unique font IDs. */
  private _nextFontId = 1;

  /** Mock bridge does NOT support real TrueType metrics. */
  readonly supportsRealFonts = false;

  async writeContentOps(pageIndex: number, ops: ContentOp[]): Promise<void> {
    const existing = this.pages.get(pageIndex) ?? [];
    this.pages.set(pageIndex, [...existing, ...ops]);
  }

  async registerFont(fontData: Uint8Array, fontName: string): Promise<FontHandle> {
    const id = `mock-font-${this._nextFontId++}`;
    this.registeredFonts.set(id, { fontName, data: fontData });
    return {
      id,
      family: fontName,
      weight: 'normal',
      style: 'normal',
    };
  }

  async measureText(fontHandle: FontHandle, text: string, size: number): Promise<number> {
    // Fall back to AFM scaffold metrics for test compatibility
    return afmMeasureTextWidth(text, fontHandle, size);
  }

  async finalizeFonts(): Promise<Map<string, FinalizedFont>> {
    // Mock: return a resource entry for each registered font
    const result = new Map<string, FinalizedFont>();
    let refCounter = 100;
    let fontIndex = 1;
    for (const [id] of this.registeredFonts) {
      result.set(id, {
        type0Ref: refCounter++,
        resourceName: `/F${fontIndex++}`,
      });
    }
    return result;
  }

  // ── Test Helpers ──────────────────────────────────────────────────

  /** Get ops for a specific page. */
  getOps(pageIndex: number): ContentOp[] {
    return this.pages.get(pageIndex) ?? [];
  }

  /** Get all ops across all pages (flattened). */
  getAllOps(): ContentOp[] {
    const result: ContentOp[] = [];
    for (const ops of this.pages.values()) {
      result.push(...ops);
    }
    return result;
  }

  /** Clear all captured ops and registered fonts. */
  clear(): void {
    this.pages.clear();
    this.registeredFonts.clear();
    this._nextFontId = 1;
  }
}

// ── TauriFontBridge ─────────────────────────────────────────────────────

/**
 * Production IpcBridge that connects to the Rust pdf-core via Tauri IPC.
 *
 * Each method delegates to a Tauri invoke() command that calls into the
 * Rust FontRegistry and content stream builder.
 *
 * Usage:
 * ```typescript
 * import { TauriFontBridge } from '@mog/pdf-graphics';
 *
 * const bridge = new TauriFontBridge();
 * const canvas = new PdfCanvas(bridge);
 *
 * // Register a font from raw TTF bytes
 * const handle = await bridge.registerFont(calibriData, 'Calibri');
 * canvas.setFont(handle, 12);
 *
 * // All measureText calls now use real TrueType metrics from Rust
 * canvas.beginPage(612, 792);
 * canvas.drawText('Hello', 100, 100, {});
 * await canvas.endPage();
 *
 * // Finalize fonts for PDF embedding
 * const fontResources = await bridge.finalizeFonts();
 * ```
 */
export class TauriFontBridge implements IpcBridge {
  /** Tauri invoke function — injected for testability. */
  private readonly _invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

  /** Real bridge supports TrueType metrics from Rust. */
  readonly supportsRealFonts = true;

  /**
   * @param invoke - The Tauri invoke function. Defaults to the global
   *   window.__TAURI__.invoke when available.
   */
  constructor(invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>) {
    this._invoke = invoke ?? TauriFontBridge._defaultInvoke;
  }

  async writeContentOps(pageIndex: number, ops: ContentOp[]): Promise<void> {
    await this._invoke('pdf_write_content_ops', { pageIndex, ops });
  }

  async registerFont(fontData: Uint8Array, fontName: string): Promise<FontHandle> {
    const result = (await this._invoke('pdf_register_font', {
      fontData: Array.from(fontData),
      fontName,
    })) as { id: string; family: string; weight: string; style: string };

    return {
      id: result.id,
      family: result.family,
      weight: (result.weight as 'normal' | 'bold') ?? 'normal',
      style: (result.style as 'normal' | 'italic') ?? 'normal',
    };
  }

  async measureText(fontHandle: FontHandle, text: string, size: number): Promise<number> {
    return (await this._invoke('pdf_measure_text', {
      fontId: fontHandle.id,
      text,
      size,
    })) as number;
  }

  async finalizeFonts(): Promise<Map<string, FinalizedFont>> {
    const raw = (await this._invoke('pdf_finalize_fonts')) as Record<
      string,
      { type0Ref: number; resourceName: string }
    >;

    const result = new Map<string, FinalizedFont>();
    for (const [id, info] of Object.entries(raw)) {
      result.set(id, info);
    }
    return result;
  }

  /**
   * Default invoke function that tries to use Tauri's global.
   * Throws a clear error if Tauri is not available.
   */
  private static async _defaultInvoke(
    cmd: string,
    args?: Record<string, unknown>,
  ): Promise<unknown> {
    const tauriInvoke = window.__TAURI__?.invoke;
    if (typeof tauriInvoke !== 'function') {
      throw new Error(
        `TauriFontBridge: Tauri runtime not available. ` +
          `Cannot invoke '${cmd}'. Use MockIpcBridge for testing.`,
      );
    }
    return tauriInvoke(cmd, args);
  }
}
