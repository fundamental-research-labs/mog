/**
 * WorkbookThemeImpl -- Theme management sub-API implementation.
 *
 * Two orthogonal theme axes:
 * - Workbook theme (ThemeDefinition): OOXML palette stored in Rust via bridge.
 * - Chrome theme (ChromeTheme): Canvas UI shell colors, TS-only session config.
 *
 * Wire format conversion:
 *   ThemeDefinition (named-field colors) <-> ThemeData (array of {name, color})
 *   Rust stores ThemeData; the API surface uses ThemeDefinition.
 *
 * `ThemeData` / `ThemeColor` come from the generated bridge types
 * (compute-types.gen.ts) — they match the Rust wire format exactly. The older
 * hand-written `ThemeDataWire` / `ThemeColorWire` aliases were removed once
 * the codegen learned about domain-types/src/domain/theme.rs.
 */
import type { WorkbookTheme } from '@mog-sdk/contracts/api';
import type { ThemeDefinition, ThemeColors } from '@mog-sdk/contracts/theme';
import type { ChromeTheme } from '@mog-sdk/contracts/rendering';
import type { IEventBus } from '@mog-sdk/contracts/events';

import type { DocumentContext } from '../../context';
import type { ThemeData, ThemeColor } from '../../bridges/compute/compute-types.gen';

// =============================================================================
// Wire Format Conversion
// =============================================================================

/** Map from ThemeColors named fields to Rust wire slot names. */
const SLOT_TO_WIRE: Record<keyof ThemeColors, string> = {
  dark1: 'dk1',
  light1: 'lt1',
  dark2: 'dk2',
  light2: 'lt2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hyperlink: 'hlink',
  followedHyperlink: 'folHlink',
};

const WIRE_TO_SLOT: Record<string, keyof ThemeColors> = Object.fromEntries(
  Object.entries(SLOT_TO_WIRE).map(([k, v]) => [v, k as keyof ThemeColors]),
) as Record<string, keyof ThemeColors>;

function themeDefinitionToWire(theme: ThemeDefinition): ThemeData {
  const colors: ThemeColor[] = (Object.keys(SLOT_TO_WIRE) as (keyof ThemeColors)[]).map((slot) => ({
    name: SLOT_TO_WIRE[slot],
    color: theme.colors[slot],
  }));
  return {
    colors,
    majorFont: theme.fonts.majorFont,
    minorFont: theme.fonts.minorFont,
    name: theme.name,
  };
}

function mergeThemeDefinitionIntoWire(
  theme: ThemeDefinition,
  current: ThemeData | null,
): ThemeData {
  return {
    ...(current ?? {}),
    ...themeDefinitionToWire(theme),
  };
}

function wireToThemeDefinition(wire: ThemeData): ThemeDefinition {
  // Build ThemeColors from wire array. Fall back to empty string for missing slots.
  const colors = {} as Record<keyof ThemeColors, string>;
  for (const slot of Object.keys(SLOT_TO_WIRE) as (keyof ThemeColors)[]) {
    colors[slot] = '';
  }
  for (const entry of wire.colors) {
    const slot = WIRE_TO_SLOT[entry.name];
    if (slot) {
      colors[slot] = entry.color;
    }
  }

  return {
    id: wire.name ?? 'custom',
    name: wire.name ?? 'Custom',
    colors: colors as ThemeColors,
    fonts: {
      majorFont: wire.majorFont ?? 'Calibri Light',
      minorFont: wire.minorFont ?? 'Calibri',
    },
    builtIn: false,
  };
}

// =============================================================================
// WorkbookThemeImpl
// =============================================================================

export interface WorkbookThemeDeps {
  ctx: DocumentContext;
  eventBus: IEventBus;
}

export class WorkbookThemeImpl implements WorkbookTheme {
  private readonly ctx: DocumentContext;
  private readonly eventBus: IEventBus;
  private _chromeTheme: ChromeTheme;

  constructor(deps: WorkbookThemeDeps, initialChromeTheme: ChromeTheme) {
    this.ctx = deps.ctx;
    this.eventBus = deps.eventBus;
    this._chromeTheme = { ...initialChromeTheme };
  }

  // ---------------------------------------------------------------------------
  // Workbook Theme (async — Rust bridge)
  // ---------------------------------------------------------------------------

  async getWorkbookTheme(): Promise<ThemeDefinition> {
    const wire = await this.ctx.computeBridge.getWorkbookTheme();
    return wireToThemeDefinition(wire);
  }

  async setWorkbookTheme(theme: ThemeDefinition): Promise<void> {
    const current = await this.ctx.computeBridge.getWorkbookTheme();
    const wire = mergeThemeDefinitionIntoWire(theme, current);
    await this.ctx.computeBridge.setWorkbookTheme(wire);

    // Emit event so the shell/renderer layer can react
    this.eventBus.emit({
      type: 'workbook:theme-changed',
      timestamp: Date.now(),
      oldThemeId: undefined,
      newThemeId: theme.id,
      customTheme: theme,
      source: 'user',
    });
  }

  // ---------------------------------------------------------------------------
  // Chrome Theme (sync — TS-only)
  // ---------------------------------------------------------------------------

  getChromeTheme(): ChromeTheme {
    return { ...this._chromeTheme };
  }

  setChromeTheme(theme: Partial<ChromeTheme>): void {
    // Merge partial with CURRENT theme (not defaults)
    this._chromeTheme = { ...this._chromeTheme, ...theme };

    // Emit event so the shell/renderer layer can update canvas + CSS vars
    this.eventBus.emit({
      type: 'chrome:theme-changed',
      timestamp: Date.now(),
      chromeTheme: { ...this._chromeTheme },
    });
  }
}
