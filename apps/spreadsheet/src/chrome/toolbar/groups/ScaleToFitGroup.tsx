/**
 * ScaleToFitGroup Component
 *
 * Self-sufficient Scale to Fit group for the Page Layout ribbon.
 * Contains: Width, Height, Scale percentage controls
 *
 * NOTE: Scale to Fit is currently a stub - the controls are rendered
 * but not connected to actual page scaling logic. This is marked as P3
 * priority in the PageLayoutRibbon comments.
 *
 * This follows the HomeRibbon group pattern - no props, all state
 * will come from hooks when implemented.
 *
 */

import { useState } from 'react';

import { SCALE_TO_FIT_COLLAPSE_CONFIG } from '@mog-sdk/contracts/ribbon';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import { ScaleHeightIcon, ScaleIcon, ScaleWidthIcon } from '../primitives/ToolbarIcons';

// =============================================================================
// Component
// =============================================================================

/**
 * ScaleToFitGroup - Self-sufficient scale to fit group.
 *
 * Currently uses local state as placeholder until Scale to Fit
 * is properly implemented in the print system.
 *
 * Priority: Ribbon Polish
 */
export function ScaleToFitGroup() {
  // ===========================================================================
  // Local State (placeholder until Scale to Fit is implemented)
  // ===========================================================================

  // TODO: Replace with hook once Scale to Fit is implemented in print system
  const [scaleWidth, setScaleWidth] = useState('auto');
  const [scaleHeight, setScaleHeight] = useState('auto');
  const [scalePercent, setScalePercent] = useState(100);

  // Scale to Fit is not yet implemented - controls are disabled
  const isEnabled = false;

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
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <ScaleWidthIcon />
            <span className="text-ribbon text-ss-text-tertiary">Width:</span>
          </div>
          <select
            value={scaleWidth}
            onChange={(e) => setScaleWidth(e.target.value)}
            disabled={!isEnabled}
            className={`
 h-6 px-1 rounded border border-ss-border
 bg-ss-surface text-ribbon text-ss-text-secondary
 outline-none w-[70px]
 ${isEnabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}
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

        {/* Height dropdown */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <ScaleHeightIcon />
            <span className="text-ribbon text-ss-text-tertiary">Height:</span>
          </div>
          <select
            value={scaleHeight}
            onChange={(e) => setScaleHeight(e.target.value)}
            disabled={!isEnabled}
            className={`
 h-6 px-1 rounded border border-ss-border
 bg-ss-surface text-ribbon text-ss-text-secondary
 outline-none w-[70px]
 ${isEnabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}
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

        {/* Scale percentage */}
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
              onChange={(e) => setScalePercent(parseInt(e.target.value, 10))}
              disabled={!isEnabled}
              className={`
 h-6 px-1 rounded border border-ss-border
 bg-ss-surface text-ribbon text-ss-text-secondary text-center
 outline-none w-[50px]
 ${isEnabled ? 'cursor-text' : 'cursor-not-allowed opacity-50'}
 `}
              title="Scale Percentage"
              aria-label="Scale Percentage"
            />
            <span className="text-ribbon text-ss-text-tertiary">%</span>
          </div>
        </div>
      </div>
    </ToolbarGroup>
  );
}
