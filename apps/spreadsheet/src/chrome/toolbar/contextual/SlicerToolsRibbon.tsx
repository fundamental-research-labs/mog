/**
 * FilterControlToolsRibbon
 *
 * Contextual command tab shown when a filter control is selected.
 * Provides styles, settings, and layout controls.
 *
 * Groups:
 * - Filter control: settings, report connections
 * - Filter control styles: Style gallery (light, dark, custom)
 * - Buttons: Columns, Button height/width
 * - Size: Height, Width dimensions
 */

import { useCallback, useState } from 'react';
import { dispatch } from '../../../internal-api';
import { useActionDependencies } from '../../../hooks/toolbar/use-action-dependencies';
import { PRODUCT_VOCABULARY } from '../../../ux/product-vocabulary';
import { GalleryItem } from '../galleries/GalleryItem';
import { GallerySection } from '../galleries/GallerySection';
import { RibbonButton } from '../primitives/RibbonButton';
import { RibbonDropdownPanel } from '../primitives/RibbonDropdown';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import { DeleteIcon } from '../primitives/ToolbarIcons';
import type { ContextualTabProps } from './contextual-tab-registry';

// =============================================================================
// Types
// =============================================================================

interface SlicerStyle {
  id: string;
  name: string;
  preview: string; // CSS class or color
}

// =============================================================================
// Constants
// =============================================================================

/** Predefined slicer styles matching Excel */
const SLICER_STYLES: SlicerStyle[] = [
  { id: 'light-1', name: 'Light 1', preview: '#e8f5e9' },
  { id: 'light-2', name: 'Light 2', preview: '#e3f2fd' },
  { id: 'light-3', name: 'Light 3', preview: '#fff3e0' },
  { id: 'light-4', name: 'Light 4', preview: '#fce4ec' },
  { id: 'light-5', name: 'Light 5', preview: '#f3e5f5' },
  { id: 'light-6', name: 'Light 6', preview: '#e0f7fa' },
  { id: 'dark-1', name: 'Dark 1', preview: '#1b5e20' },
  { id: 'dark-2', name: 'Dark 2', preview: '#0d47a1' },
  { id: 'dark-3', name: 'Dark 3', preview: '#e65100' },
  { id: 'dark-4', name: 'Dark 4', preview: '#880e4f' },
  { id: 'dark-5', name: 'Dark 5', preview: '#4a148c' },
  { id: 'dark-6', name: 'Dark 6', preview: '#006064' },
];

// =============================================================================
// Icons (inline until added to ToolbarIcons.tsx)
// =============================================================================

/** Slicer icon */
const SlicerIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <rect x="2" y="2" width="12" height="12" rx="1" />
    <path d="M2 5H14" />
    <path d="M5 5V14" />
  </svg>
);

/** Settings icon */
const SettingsIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <circle cx="8" cy="8" r="2" />
    <path d="M8 2V4M8 12V14M2 8H4M12 8H14M3.5 3.5L5 5M11 11L12.5 12.5M3.5 12.5L5 11M11 5L12.5 3.5" />
  </svg>
);

/** Connections icon */
const ConnectionsIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <circle cx="4" cy="4" r="2" />
    <circle cx="12" cy="4" r="2" />
    <circle cx="8" cy="12" r="2" />
    <path d="M5.5 5.5L7 10.5M10.5 5.5L9 10.5" />
  </svg>
);

/** Size icon */
const SizeIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d="M2 2H6M2 2V6M2 2L6 6" />
    <path d="M14 14H10M14 14V10M14 14L10 10" />
    <rect x="3" y="3" width="10" height="10" rx="0.5" strokeDasharray="2 1" />
  </svg>
);

// =============================================================================
// Component
// =============================================================================

export function SlicerToolsRibbon(_props: ContextualTabProps) {
  const deps = useActionDependencies();
  const [styleDropdownOpen, setStyleDropdownOpen] = useState(false);

  // TODO: Get selected slicer state from hooks when slicer selection is implemented
  const selectedSlicerId: string | null = null;
  const currentStyleId = 'light-1';
  const columns = 1;
  const buttonHeight = '0.25"';
  const buttonWidth = '0.89"';

  // ==========================================================================
  // Handlers
  // ==========================================================================

  const handleOpenSettings = useCallback(() => {
    if (selectedSlicerId) {
      dispatch('OPEN_SLICER_SETTINGS', deps, { slicerId: selectedSlicerId });
    }
  }, [selectedSlicerId, deps]);

  const handleOpenConnections = useCallback(() => {
    if (selectedSlicerId) {
      dispatch('OPEN_SLICER_CONNECTIONS', deps, { slicerId: selectedSlicerId });
    }
  }, [selectedSlicerId, deps]);

  const handleSelectStyle = useCallback(
    (styleId: string) => {
      if (selectedSlicerId) {
        // TODO: Dispatch slicer style change action when implemented
        console.log('Change slicer style to:', styleId);
      }
      setStyleDropdownOpen(false);
    },
    [selectedSlicerId, deps],
  );

  const handleDelete = useCallback(() => {
    if (selectedSlicerId) {
      dispatch('DELETE_SLICER', deps, { slicerId: selectedSlicerId });
    }
  }, [selectedSlicerId, deps]);

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="flex items-center h-full gap-2 px-2">
      {/* Filter control group */}
      <ToolbarGroup label={PRODUCT_VOCABULARY.filterControl.label}>
        <div className="flex items-center gap-0.5">
          <RibbonButton
            layout="vertical"
            height="full"
            icon={<SettingsIcon />}
            label="Settings"
            onClick={handleOpenSettings}
            disabled={!selectedSlicerId}
            title={`${PRODUCT_VOCABULARY.filterControl.label} settings`}
            aria-label={`${PRODUCT_VOCABULARY.filterControl.label} settings`}
          />
          <RibbonButton
            layout="vertical"
            height="full"
            icon={<ConnectionsIcon />}
            label="Report Connections"
            onClick={handleOpenConnections}
            disabled={!selectedSlicerId}
            title="Report Connections"
            aria-label="Report Connections"
          />
        </div>
      </ToolbarGroup>

      {/* Filter control styles group */}
      <ToolbarGroup label={`${PRODUCT_VOCABULARY.filterControl.label} styles`}>
        <div className="relative">
          <RibbonButton
            layout="vertical"
            height="full"
            data-testid="ribbon-dropdown-slicer-styles"
            icon={<SlicerIcon />}
            label="Styles"
            hasDropdown
            isOpen={styleDropdownOpen}
            onClick={() => setStyleDropdownOpen(!styleDropdownOpen)}
            title={`${PRODUCT_VOCABULARY.filterControl.label} styles`}
            aria-label={`${PRODUCT_VOCABULARY.filterControl.label} styles`}
          />

          <RibbonDropdownPanel open={styleDropdownOpen} onClose={() => setStyleDropdownOpen(false)}>
            <div data-testid="ribbon-dropdown-menu-slicer-styles">
              <GallerySection title="Light">
                <div className="grid grid-cols-6 gap-1 p-2">
                  {SLICER_STYLES.filter((s) => s.id.startsWith('light')).map((style) => (
                    <GalleryItem
                      key={style.id}
                      dataValue={style.id}
                      onClick={() => handleSelectStyle(style.id)}
                      isSelected={style.id === currentStyleId}
                      title={style.name}
                      preview={
                        <div
                          className="w-8 h-8 rounded border"
                          style={{ backgroundColor: style.preview }}
                        />
                      }
                    />
                  ))}
                </div>
              </GallerySection>
              <GallerySection title="Dark">
                <div className="grid grid-cols-6 gap-1 p-2">
                  {SLICER_STYLES.filter((s) => s.id.startsWith('dark')).map((style) => (
                    <GalleryItem
                      key={style.id}
                      dataValue={style.id}
                      onClick={() => handleSelectStyle(style.id)}
                      isSelected={style.id === currentStyleId}
                      title={style.name}
                      preview={
                        <div
                          className="w-8 h-8 rounded border"
                          style={{ backgroundColor: style.preview }}
                        />
                      }
                    />
                  ))}
                </div>
              </GallerySection>
            </div>
          </RibbonDropdownPanel>
        </div>
      </ToolbarGroup>

      {/* Buttons Group */}
      <ToolbarGroup label="Buttons">
        <div className="flex items-center gap-2 py-1">
          <div className="flex flex-col gap-1">
            <label className="text-ribbon text-ss-text-secondary">Columns:</label>
            <input
              type="number"
              min={1}
              max={10}
              value={columns}
              className="w-16 h-6 px-1 text-ribbon border rounded"
              onChange={(e) => {
                // TODO: Update columns when slicer is selected
                console.log('Columns:', e.target.value);
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-ribbon text-ss-text-secondary">Height:</label>
            <input
              type="text"
              value={buttonHeight}
              className="w-16 h-6 px-1 text-ribbon border rounded"
              onChange={(e) => {
                // TODO: Update button height
                console.log('Height:', e.target.value);
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-ribbon text-ss-text-secondary">Width:</label>
            <input
              type="text"
              value={buttonWidth}
              className="w-16 h-6 px-1 text-ribbon border rounded"
              onChange={(e) => {
                // TODO: Update button width
                console.log('Width:', e.target.value);
              }}
            />
          </div>
        </div>
      </ToolbarGroup>

      {/* Size Group */}
      <ToolbarGroup label="Size" isLast>
        <div className="flex items-center gap-0.5">
          <RibbonButton
            layout="vertical"
            height="full"
            icon={<SizeIcon />}
            label="Size & Properties"
            onClick={() => {
              if (selectedSlicerId) {
                dispatch('OPEN_SLICER_SIZE_PROPERTIES', deps, { slicerId: selectedSlicerId });
              }
            }}
            disabled={!selectedSlicerId}
            title="Size & Properties"
            aria-label="Size & Properties"
          />
          <RibbonButton
            layout="vertical"
            height="full"
            icon={<DeleteIcon />}
            label="Remove"
            onClick={handleDelete}
            disabled={!selectedSlicerId}
            title={`Delete ${PRODUCT_VOCABULARY.filterControl.label.toLowerCase()}`}
            aria-label={`Delete ${PRODUCT_VOCABULARY.filterControl.label.toLowerCase()}`}
          />
        </div>
      </ToolbarGroup>
    </div>
  );
}
