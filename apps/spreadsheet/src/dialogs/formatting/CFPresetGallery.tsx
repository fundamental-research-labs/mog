/**
 * CF Preset Gallery Component
 *
 * Dropdown gallery for quick application of conditional formatting presets.
 * Shows Data Bars, Color Scales, and Icon Sets in a categorized layout.
 *
 * Uses useConditionalFormatting hook for consistent CF rule creation.
 */

import { useCallback } from 'react';
import { useConditionalFormatting, useUIStore } from '../../internal-api';

import type {
  CFColorScalePreset,
  CFDataBarPreset,
  CFIconSetPreset,
  CFPreset,
} from '@mog-sdk/contracts/conditional-format';
import {
  COLOR_SCALE_PRESETS,
  DATA_BAR_PRESETS,
  ICON_SET_PRESETS,
} from '@mog/spreadsheet-utils/cf-presets';
import { CFPresetThumbnail } from './CFPresetThumbnail';
// =============================================================================
// Types
// =============================================================================

interface CFPresetGalleryProps {
  onClose: () => void;
  onNewRule?: () => void;
  onManageRules?: () => void;
}

// =============================================================================
// Constants
// =============================================================================

// Show first 4 of each category in compact view
const COMPACT_COUNT = 4;

// =============================================================================
// Component
// =============================================================================

export function CFPresetGallery({ onClose, onNewRule, onManageRules }: CFPresetGalleryProps) {
  // Use the hook for consistent CF rule creation
  const cf = useConditionalFormatting();
  const openCFDialog = useUIStore((s) => s.openCFDialog);
  const openRulesManager = useUIStore((s) => s.openRulesManager);

  // Apply a preset to the current selection using the hook
  const applyPreset = useCallback(
    (preset: CFPreset) => {
      switch (preset.category) {
        case 'dataBar': {
          const dbPreset = preset as CFDataBarPreset;
          cf.applyDataBar(dbPreset.dataBar);
          break;
        }
        case 'colorScale': {
          const csPreset = preset as CFColorScalePreset;
          cf.applyColorScale(csPreset.colorScale);
          break;
        }
        case 'iconSet': {
          const isPreset = preset as CFIconSetPreset;
          cf.applyIconSet(isPreset.iconSet);
          break;
        }
        default:
          return;
      }
      onClose();
    },
    [cf, onClose],
  );

  // Handle New Rule click
  const handleNewRule = useCallback(() => {
    onClose();
    if (onNewRule) {
      onNewRule();
    } else {
      openCFDialog('create');
    }
  }, [onClose, onNewRule, openCFDialog]);

  // Handle Manage Rules click
  const handleManageRules = useCallback(() => {
    onClose();
    if (onManageRules) {
      onManageRules();
    } else {
      openRulesManager();
    }
  }, [onClose, onManageRules, openRulesManager]);

  return (
    <div
      className="bg-ss-surface rounded-ss-lg shadow-ss-lg w-80 max-h-[480px] overflow-auto py-2"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Data Bars Section */}
      <div className="px-3 py-2">
        <div className="text-dropdown-header font-semibold text-ss-text-secondary uppercase tracking-wide mb-2">
          Data Bars
        </div>
        <div className="grid grid-cols-4 gap-1">
          {DATA_BAR_PRESETS.slice(0, COMPACT_COUNT).map((preset) => (
            <PresetItem key={preset.id} preset={preset} onClick={() => applyPreset(preset)} />
          ))}
        </div>
        {DATA_BAR_PRESETS.length > COMPACT_COUNT && (
          <MoreLink count={DATA_BAR_PRESETS.length} onClick={handleNewRule} />
        )}
      </div>

      <div className="h-px bg-ss-surface-tertiary mx-3 my-1" />

      {/* Color Scales Section */}
      <div className="px-3 py-2">
        <div className="text-dropdown-header font-semibold text-ss-text-secondary uppercase tracking-wide mb-2">
          Color Scales
        </div>
        <div className="grid grid-cols-4 gap-1">
          {COLOR_SCALE_PRESETS.slice(0, COMPACT_COUNT).map((preset) => (
            <PresetItem key={preset.id} preset={preset} onClick={() => applyPreset(preset)} />
          ))}
        </div>
        {COLOR_SCALE_PRESETS.length > COMPACT_COUNT && (
          <MoreLink count={COLOR_SCALE_PRESETS.length} onClick={handleNewRule} />
        )}
      </div>

      <div className="h-px bg-ss-surface-tertiary mx-3 my-1" />

      {/* Icon Sets Section */}
      <div className="px-3 py-2">
        <div className="text-dropdown-header font-semibold text-ss-text-secondary uppercase tracking-wide mb-2">
          Icon Sets
        </div>
        <div className="grid grid-cols-4 gap-1">
          {ICON_SET_PRESETS.slice(0, COMPACT_COUNT).map((preset) => (
            <PresetItem key={preset.id} preset={preset} onClick={() => applyPreset(preset)} />
          ))}
        </div>
        {ICON_SET_PRESETS.length > COMPACT_COUNT && (
          <MoreLink count={ICON_SET_PRESETS.length} onClick={handleNewRule} />
        )}
      </div>

      <div className="h-px bg-ss-surface-tertiary mx-3 my-1" />

      {/* Actions */}
      <ActionItem icon="+" label="New Rule..." onClick={handleNewRule} />
      <ActionItem icon="⚙" label="Manage Rules..." onClick={handleManageRules} />
    </div>
  );
}

// =============================================================================
// Sub-Components
// =============================================================================

interface PresetItemProps {
  preset: CFPreset;
  onClick: () => void;
}

function PresetItem({ preset, onClick }: PresetItemProps) {
  return (
    <div
      className="p-1.5 border border-transparent rounded cursor-pointer flex flex-col items-center gap-0.5 transition-all hover:bg-ss-surface-hover hover:border-ss-primary-light"
      onClick={onClick}
      title={preset.name}
    >
      <CFPresetThumbnail preset={preset} width={48} height={20} />
    </div>
  );
}

interface MoreLinkProps {
  count: number;
  onClick: () => void;
}

function MoreLink({ count, onClick }: MoreLinkProps) {
  return (
    <div
      className="text-hint text-ss-primary cursor-pointer py-1 text-right hover:underline"
      onClick={onClick}
    >
      More ({count} total)...
    </div>
  );
}

interface ActionItemProps {
  icon: string;
  label: string;
  onClick: () => void;
}

function ActionItem({ icon, label, onClick }: ActionItemProps) {
  return (
    <div
      className="px-4 py-2 cursor-pointer flex items-center gap-2 text-dropdown text-ss-text transition-colors hover:bg-ss-surface-hover"
      onClick={onClick}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </div>
  );
}
