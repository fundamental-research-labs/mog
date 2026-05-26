import { useEffect, useMemo, useState } from 'react';

import { createResolvedSheetViewSkinForScheme } from '@mog-sdk/sheet-view';
import type { ResolvedSheetViewSkin } from '@mog-sdk/contracts/rendering/sheet-view-skin';
import { useUIStore } from '../../internal-api';
import type { SpreadsheetDisplayMode } from '../../ui-store/slices/core/display-mode';

export type ResolvedDisplayScheme = 'light' | 'dark';

function getSystemScheme(): ResolvedDisplayScheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveDisplayScheme(
  mode: SpreadsheetDisplayMode,
  systemScheme: ResolvedDisplayScheme,
): ResolvedDisplayScheme {
  return mode === 'system' ? systemScheme : mode;
}

export function useSpreadsheetDisplayMode(): {
  mode: SpreadsheetDisplayMode;
  effectiveScheme: ResolvedDisplayScheme;
  rendererSkin: ResolvedSheetViewSkin;
  setMode: (mode: SpreadsheetDisplayMode) => void;
} {
  const mode = useUIStore((s) => s.spreadsheetDisplayMode);
  const setMode = useUIStore((s) => s.setSpreadsheetDisplayMode);
  const [systemScheme, setSystemScheme] = useState<ResolvedDisplayScheme>(() => getSystemScheme());

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemScheme(query.matches ? 'dark' : 'light');
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  const effectiveScheme = resolveDisplayScheme(mode, systemScheme);
  const rendererSkin = useMemo(
    () => createResolvedSheetViewSkinForScheme(effectiveScheme, { skin: null }),
    [effectiveScheme],
  );

  return { mode, effectiveScheme, rendererSkin, setMode };
}
