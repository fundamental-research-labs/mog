/**
 * useWorkbookSettings Hook
 *
 * Provides reactive workbook settings (scrollbars, tab strip, formula bar visibility).
 * Subscribes to EventBus for real-time updates when workbook settings change.
 *
 * Settings & Toggles
 *
 * Architecture:
 * - Reads: sync from `wb.mirror.getWorkbookSettings()` (kernel state mirror)
 * - Writes: void wb.setSettings() (fire-and-forget)
 * - EventBus subscription for reactive updates
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { AutomaticConversionPolicy, WorkbookSettings } from '@mog-sdk/contracts/core';
import { useWorkbook } from '../../infra/context';

export interface UseWorkbookSettingsReturn {
  /** Current workbook settings state */
  settings: WorkbookSettings;
  /** Set a specific setting value */
  setSetting: <K extends keyof WorkbookSettings>(
    key: K,
    value: WorkbookSettings[K],
  ) => Promise<void>;
  /** Toggle a boolean setting */
  toggleSetting: (key: keyof WorkbookSettings) => void;
  /** Set one automatic conversion policy field. */
  setAutomaticConversionPolicyField: (
    field: keyof AutomaticConversionPolicy,
    value: boolean,
  ) => void;
  /** Restore automatic conversion policy defaults. */
  restoreAutomaticConversionDefaults: () => void;
}

const AUTOMATIC_CONVERSION_DEFAULTS: AutomaticConversionPolicy = {
  convertDateLikeText: true,
  convertTimeLikeText: true,
  convertFractionLikeText: true,
  convertScientificNotation: true,
  convertLeadingZeroNumbers: true,
  convertLongDigitNumbers: true,
  convertPercentSuffix: true,
  convertCurrencySymbol: true,
  convertFormattedNumbers: true,
};

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for managing workbook settings with reactive EventBus subscription.
 *
 * - Sync init from `wb.mirror.getWorkbookSettings()` — first paint is correct.
 * - Live updates via the `workbook:settings-changed` event.
 * - Writes via `wb.setSettings()` (fire-and-forget).
 *
 * @returns Workbook settings state and setter functions
 */
export function useWorkbookSettings(): UseWorkbookSettingsReturn {
  const wb = useWorkbook();

  // Sync init from kernel state mirror.
  const [settings, setSettings] = useState<WorkbookSettings>(() => wb.mirror.getWorkbookSettings());

  // Ref to hold latest settings for toggleSetting (avoids stale closure)
  const settingsRef = useRef<WorkbookSettings>(settings);
  settingsRef.current = settings;

  // Subscribe to wb.on for workbook settings changes
  useEffect(() => {
    const unsubscribe = wb.on('workbook:settings-changed', (event) => {
      setSettings(event.settings);
    });

    return unsubscribe;
  }, [wb]);

  // Set a specific setting value. UI updates optimistically; callers may await
  // the persisted write when subsequent work depends on the new setting.
  const setSetting = useCallback(
    async <K extends keyof WorkbookSettings>(key: K, value: WorkbookSettings[K]) => {
      // Optimistically update local state
      setSettings((prev) => ({ ...prev, [key]: value }));
      // Write via unified Workbook API
      await wb.setSettings({ [key]: value });
    },
    [wb],
  );

  // Toggle a boolean setting
  // IMPORTANT: Read from ref (tracks latest state), not stale closure
  // This ensures rapid toggle operations work correctly even when React batches updates
  const toggleSetting = useCallback(
    (key: keyof WorkbookSettings) => {
      const current = settingsRef.current[key];
      if (typeof current === 'boolean') {
        const newSettings = { ...settingsRef.current, [key]: !current };
        setSettings(newSettings);
        void wb.setSettings({ [key]: !current });
      }
    },
    [wb],
  );

  const setAutomaticConversionPolicyField = useCallback(
    (field: keyof AutomaticConversionPolicy, value: boolean) => {
      const currentPolicy =
        settingsRef.current.automaticConversionPolicy ?? AUTOMATIC_CONVERSION_DEFAULTS;
      const nextPolicy = { ...currentPolicy, [field]: value };
      setSettings((prev) => ({ ...prev, automaticConversionPolicy: nextPolicy }));
      void wb.setSettings({ automaticConversionPolicy: { [field]: value } });
    },
    [wb],
  );

  const restoreAutomaticConversionDefaults = useCallback(() => {
    const currentPolicy =
      settingsRef.current.automaticConversionPolicy ?? AUTOMATIC_CONVERSION_DEFAULTS;
    const alreadyDefault = Object.entries(AUTOMATIC_CONVERSION_DEFAULTS).every(
      ([key, value]) => currentPolicy[key as keyof AutomaticConversionPolicy] === value,
    );
    if (alreadyDefault) {
      return;
    }
    setSettings((prev) => ({
      ...prev,
      automaticConversionPolicy: AUTOMATIC_CONVERSION_DEFAULTS,
    }));
    void wb.setSettings({ automaticConversionPolicy: AUTOMATIC_CONVERSION_DEFAULTS });
  }, [wb]);

  return {
    settings,
    setSetting,
    toggleSetting,
    setAutomaticConversionPolicyField,
    restoreAutomaticConversionDefaults,
  };
}
