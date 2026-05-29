/**
 * ScaleToFitGroup Component
 *
 * Self-sufficient Scale to Fit group for the Page Layout ribbon.
 * Contains: Width, Height, Scale percentage controls
 *
 */

import { useCallback } from 'react';

import { SCALE_TO_FIT_COLLAPSE_CONFIG } from '@mog-sdk/contracts/ribbon';
import { useActiveSheetId, useDispatch, usePrintSettings } from '../../../internal-api';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import { ScaleHeightIcon, ScaleIcon, ScaleWidthIcon } from '../primitives/ToolbarIcons';
import { RibbonVisibilityItem } from '../visibility/RibbonVisibilityContext';

// =============================================================================
// Component
// =============================================================================

/**
 * ScaleToFitGroup - Self-sufficient scale to fit group.
 *
 * Reads from the active sheet print mirror and writes through the page
 * setup action handler, matching the rest of Page Layout.
 */
export function ScaleToFitGroup() {
  const dispatch = useDispatch();
  const activeSheetId = useActiveSheetId();
  const { settings } = usePrintSettings(activeSheetId);

  const scaleWidth = settings.fitToWidth == null ? 'auto' : String(settings.fitToWidth);
  const scaleHeight = settings.fitToHeight == null ? 'auto' : String(settings.fitToHeight);
  const scalePercent = settings.scale ?? 100;

  const handleFitWidthChange = useCallback(
    (value: string) => {
      dispatch('SET_PAGE_SCALE', {
        fitTo: {
          width: value === 'auto' ? undefined : Number(value),
          height: settings.fitToHeight ?? undefined,
        },
      });
    },
    [dispatch, settings.fitToHeight],
  );

  const handleFitHeightChange = useCallback(
    (value: string) => {
      dispatch('SET_PAGE_SCALE', {
        fitTo: {
          width: settings.fitToWidth ?? undefined,
          height: value === 'auto' ? undefined : Number(value),
        },
      });
    },
    [dispatch, settings.fitToWidth],
  );

  const handleScaleChange = useCallback(
    (value: string) => {
      const nextScale = Number(value);
      if (!Number.isFinite(nextScale)) return;
      dispatch('SET_PAGE_SCALE', { scale: nextScale });
    },
    [dispatch],
  );

  // ===========================================================================
  // Render
  // ===========================================================================

  return (
    <ToolbarGroup
      label="Scale to Fit"
      collapseConfig={SCALE_TO_FIT_COLLAPSE_CONFIG}
      dropdownIcon={<ScaleIcon />}
    >
      <div className="flex items-center gap-2 px-2 py-1">
        {/* Width dropdown */}
        <RibbonVisibilityItem item="width">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1">
              <ScaleWidthIcon />
              <span className="text-ribbon text-ss-text-tertiary">Width:</span>
            </div>
            <select
              value={scaleWidth}
              onChange={(e) => handleFitWidthChange(e.target.value)}
              className={`
 h-6 px-1 rounded border border-ss-border
 bg-ss-surface text-ribbon text-ss-text-secondary
 outline-none w-[70px]
 cursor-pointer
 `}
              title="Scale Width"
              aria-label="Scale Width"
            >
              <option value="auto">Automatic</option>
              <option value="1">1 page</option>
              <option value="2">2 pages</option>
              <option value="3">3 pages</option>
              <option value="4">4 pages</option>
            </select>
          </div>
        </RibbonVisibilityItem>

        {/* Height dropdown */}
        <RibbonVisibilityItem item="height">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1">
              <ScaleHeightIcon />
              <span className="text-ribbon text-ss-text-tertiary">Height:</span>
            </div>
            <select
              value={scaleHeight}
              onChange={(e) => handleFitHeightChange(e.target.value)}
              className={`
 h-6 px-1 rounded border border-ss-border
 bg-ss-surface text-ribbon text-ss-text-secondary
 outline-none w-[70px]
 cursor-pointer
 `}
              title="Scale Height"
              aria-label="Scale Height"
            >
              <option value="auto">Automatic</option>
              <option value="1">1 page</option>
              <option value="2">2 pages</option>
              <option value="3">3 pages</option>
              <option value="4">4 pages</option>
            </select>
          </div>
        </RibbonVisibilityItem>

        {/* Scale percentage */}
        <RibbonVisibilityItem item="scale">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1">
              <ScaleIcon />
              <span className="text-ribbon text-ss-text-tertiary">Scale:</span>
            </div>
            <div className="flex items-center gap-0.5">
              <input
                type="number"
                min={10}
                max={400}
                value={scalePercent}
                onChange={(e) => handleScaleChange(e.target.value)}
                className={`
 h-6 px-1 rounded border border-ss-border
 bg-ss-surface text-ribbon text-ss-text-secondary text-center
 outline-none w-[50px]
 cursor-text
 `}
                title="Scale Percentage"
                aria-label="Scale Percentage"
              />
              <span className="text-ribbon text-ss-text-tertiary">%</span>
            </div>
          </div>
        </RibbonVisibilityItem>
      </div>
    </ToolbarGroup>
  );
}
