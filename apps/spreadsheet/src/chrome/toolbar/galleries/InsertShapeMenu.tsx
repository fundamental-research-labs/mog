/**
 * Insert Shape Menu
 *
 * A dropdown menu for selecting shapes to insert into the spreadsheet.
 * Displays a gallery of shapes organized by category.
 *
 * - Click: enters insertion mode (crosshair cursor, drag on canvas to define size)
 * - Shift+click: instant insert via dispatch('INSERT_SHAPE') with smart positioning
 *
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useUIStore } from '../../../internal-api';

import type { ShapeType } from '@mog-sdk/contracts/floating-objects';
import { useDispatch } from '../../../hooks/toolbar/use-action-dependencies';
import { ShapePreviewThumbnail } from './ShapePreviewThumbnail';
// =============================================================================
// Types
// =============================================================================

interface ShapeOption {
  type: ShapeType;
  label: string;
}

interface ShapeCategory {
  name: string;
  shapes: ShapeOption[];
}

// =============================================================================
// Shape Definitions
// =============================================================================

const SHAPE_CATEGORIES: ShapeCategory[] = [
  {
    name: 'Basic Shapes',
    shapes: [
      { type: 'rect', label: 'Rectangle' },
      { type: 'roundRect', label: 'Rounded Rectangle' },
      { type: 'ellipse', label: 'Oval' },
      { type: 'triangle', label: 'Triangle' },
      { type: 'rtTriangle', label: 'Right Triangle' },
      { type: 'diamond', label: 'Diamond' },
      { type: 'pentagon', label: 'Pentagon' },
      { type: 'hexagon', label: 'Hexagon' },
      { type: 'octagon', label: 'Octagon' },
      { type: 'heptagon', label: 'Heptagon' },
      { type: 'decagon', label: 'Decagon' },
      { type: 'dodecagon', label: 'Dodecagon' },
      { type: 'parallelogram', label: 'Parallelogram' },
      { type: 'trapezoid', label: 'Trapezoid' },
      { type: 'nonIsoscelesTrapezoid', label: 'Non-Isosceles Trapezoid' },
      { type: 'teardrop', label: 'Teardrop' },
      { type: 'pie', label: 'Pie' },
      { type: 'pieWedge', label: 'Pie Wedge' },
      { type: 'blockArc', label: 'Block Arc' },
      { type: 'donut', label: 'Donut' },
      { type: 'noSmoking', label: 'No Smoking' },
      { type: 'plaque', label: 'Plaque' },
    ],
  },
  {
    name: 'Rectangles',
    shapes: [
      { type: 'round1Rect', label: 'Round Single Corner Rectangle' },
      { type: 'round2SameRect', label: 'Round Same Side Corner Rectangle' },
      { type: 'round2DiagRect', label: 'Round Diagonal Corner Rectangle' },
      { type: 'snip1Rect', label: 'Snip Single Corner Rectangle' },
      { type: 'snip2SameRect', label: 'Snip Same Side Corner Rectangle' },
      { type: 'snip2DiagRect', label: 'Snip Diagonal Corner Rectangle' },
      { type: 'snipRoundRect', label: 'Snip and Round Single Corner Rectangle' },
    ],
  },
  {
    name: 'Arrows',
    shapes: [
      { type: 'rightArrow', label: 'Right Arrow' },
      { type: 'leftArrow', label: 'Left Arrow' },
      { type: 'upArrow', label: 'Up Arrow' },
      { type: 'downArrow', label: 'Down Arrow' },
      { type: 'leftRightArrow', label: 'Left-Right Arrow' },
      { type: 'upDownArrow', label: 'Up-Down Arrow' },
      { type: 'quadArrow', label: 'Quad Arrow' },
      { type: 'chevron', label: 'Chevron' },
      { type: 'leftArrowCallout', label: 'Left Arrow Callout' },
      { type: 'rightArrowCallout', label: 'Right Arrow Callout' },
      { type: 'upArrowCallout', label: 'Up Arrow Callout' },
      { type: 'downArrowCallout', label: 'Down Arrow Callout' },
      { type: 'leftRightArrowCallout', label: 'Left-Right Arrow Callout' },
      { type: 'upDownArrowCallout', label: 'Up-Down Arrow Callout' },
      { type: 'quadArrowCallout', label: 'Quad Arrow Callout' },
      { type: 'bentArrow', label: 'Bent Arrow' },
      { type: 'uturnArrow', label: 'U-Turn Arrow' },
      { type: 'circularArrow', label: 'Circular Arrow' },
      { type: 'leftCircularArrow', label: 'Left Circular Arrow' },
      { type: 'leftRightCircularArrow', label: 'Left-Right Circular Arrow' },
      { type: 'curvedRightArrow', label: 'Curved Right Arrow' },
      { type: 'curvedLeftArrow', label: 'Curved Left Arrow' },
      { type: 'curvedUpArrow', label: 'Curved Up Arrow' },
      { type: 'curvedDownArrow', label: 'Curved Down Arrow' },
      { type: 'swooshArrow', label: 'Swoosh Arrow' },
    ],
  },
  {
    name: 'Stars & Banners',
    shapes: [
      { type: 'star4', label: '4-Point Star' },
      { type: 'star5', label: '5-Point Star' },
      { type: 'star6', label: '6-Point Star' },
      { type: 'star7', label: '7-Point Star' },
      { type: 'star8', label: '8-Point Star' },
      { type: 'star10', label: '10-Point Star' },
      { type: 'star12', label: '12-Point Star' },
      { type: 'star16', label: '16-Point Star' },
      { type: 'star24', label: '24-Point Star' },
      { type: 'star32', label: '32-Point Star' },
      { type: 'ribbon', label: 'Banner strip' },
      { type: 'banner', label: 'Banner' },
    ],
  },
  {
    name: 'Callouts',
    shapes: [
      { type: 'wedgeRectCallout', label: 'Callout' },
      { type: 'wedgeRoundRectCallout', label: 'Rounded Callout' },
      { type: 'wedgeEllipseCallout', label: 'Oval Callout' },
      { type: 'cloud', label: 'Cloud' },
      { type: 'callout1', label: 'Line Callout 1' },
      { type: 'callout2', label: 'Line Callout 2' },
      { type: 'callout3', label: 'Line Callout 3' },
      { type: 'borderCallout1', label: 'Line Callout 1 (Border)' },
      { type: 'borderCallout2', label: 'Line Callout 2 (Border)' },
      { type: 'borderCallout3', label: 'Line Callout 3 (Border)' },
      { type: 'accentCallout1', label: 'Line Callout 1 (Accent Bar)' },
      { type: 'accentCallout2', label: 'Line Callout 2 (Accent Bar)' },
      { type: 'accentCallout3', label: 'Line Callout 3 (Accent Bar)' },
      { type: 'accentBorderCallout1', label: 'Line Callout 1 (Border and Accent Bar)' },
      { type: 'accentBorderCallout2', label: 'Line Callout 2 (Border and Accent Bar)' },
      { type: 'accentBorderCallout3', label: 'Line Callout 3 (Border and Accent Bar)' },
    ],
  },
  {
    name: 'Lines & Connectors',
    shapes: [
      { type: 'line', label: 'Line' },
      { type: 'lineArrow', label: 'Arrow' },
      { type: 'lineDoubleArrow', label: 'Double Arrow' },
      { type: 'curve', label: 'Curve' },
      { type: 'arc', label: 'Arc' },
      { type: 'connector', label: 'Connector' },
    ],
  },
  {
    name: 'Flowchart',
    shapes: [
      { type: 'flowChartProcess', label: 'Process' },
      { type: 'flowChartDecision', label: 'Decision' },
      { type: 'flowChartInputOutput', label: 'Data' },
      { type: 'flowChartPredefinedProcess', label: 'Predefined Process' },
      { type: 'flowChartInternalStorage', label: 'Internal Storage' },
      { type: 'flowChartDocument', label: 'Document' },
      { type: 'flowChartMultidocument', label: 'Multidocument' },
      { type: 'flowChartTerminator', label: 'Terminator' },
      { type: 'flowChartPreparation', label: 'Preparation' },
      { type: 'flowChartManualInput', label: 'Manual Input' },
      { type: 'flowChartManualOperation', label: 'Manual Operation' },
      { type: 'flowChartConnector', label: 'Connector' },
      { type: 'flowChartPunchedCard', label: 'Card' },
      { type: 'flowChartPunchedTape', label: 'Tape' },
      { type: 'flowChartSummingJunction', label: 'Summing Junction' },
      { type: 'flowChartOr', label: 'Or' },
      { type: 'flowChartCollate', label: 'Collate' },
      { type: 'flowChartSort', label: 'Sort' },
      { type: 'flowChartExtract', label: 'Extract' },
      { type: 'flowChartMerge', label: 'Merge' },
      { type: 'flowChartOfflineStorage', label: 'Stored Data' },
      { type: 'flowChartOnlineStorage', label: 'Sequential Access' },
      { type: 'flowChartMagneticTape', label: 'Magnetic Tape' },
      { type: 'flowChartMagneticDisk', label: 'Direct Access Storage' },
      { type: 'flowChartMagneticDrum', label: 'Magnetic Drum' },
      { type: 'flowChartDisplay', label: 'Display' },
      { type: 'flowChartDelay', label: 'Delay' },
      { type: 'flowChartAlternateProcess', label: 'Alternate Process' },
      { type: 'flowChartOffpageConnector', label: 'Off-Page Reference' },
    ],
  },
  {
    name: 'Symbols',
    shapes: [
      { type: 'heart', label: 'Heart' },
      { type: 'lightningBolt', label: 'Lightning Bolt' },
      { type: 'sun', label: 'Sun' },
      { type: 'moon', label: 'Moon' },
      { type: 'smileyFace', label: 'Smiley Face' },
      { type: 'foldedCorner', label: 'Folded Corner' },
      { type: 'bevel', label: 'Bevel' },
      { type: 'frame', label: 'Frame' },
      { type: 'halfFrame', label: 'Half Frame' },
      { type: 'corner', label: 'Corner' },
      { type: 'diagStripe', label: 'Diagonal Stripe' },
      { type: 'chord', label: 'Chord' },
      { type: 'can', label: 'Can' },
      { type: 'cube', label: 'Cube' },
      { type: 'plus', label: 'Plus' },
      { type: 'cross', label: 'Cross' },
      { type: 'irregularSeal1', label: 'Explosion 1' },
      { type: 'irregularSeal2', label: 'Explosion 2' },
      { type: 'homePlate', label: 'Home Plate' },
      { type: 'funnel', label: 'Funnel' },
    ],
  },
];

// =============================================================================
// Component
// =============================================================================

/**
 * Insert shape menu component with memo for performance optimization.
 * Prevents unnecessary re-renders when parent component updates.
 *
 * PERFORMANCE: Wrapped with React.memo to prevent re-renders from parent.
 */
export const InsertShapeMenu = React.memo(function InsertShapeMenu() {
  const insertShapeMenu = useUIStore((s) => s.insertShapeMenu);
  const closeMenu = useUIStore((s) => s.closeInsertShapeMenu);
  const closeRibbonDropdown = useUIStore((s) => s.closeRibbonDropdown);
  const dispatch = useDispatch();

  const { isOpen, anchorX, anchorY } = insertShapeMenu;
  const menuRef = useRef<HTMLDivElement>(null);
  const closeShapesMenu = useCallback(() => {
    closeMenu();
    closeRibbonDropdown('insert.shapes');
  }, [closeMenu, closeRibbonDropdown]);

  // Calculate menu position
  const menuPosition = useMemo(() => {
    if (typeof window === 'undefined') return { left: anchorX, top: anchorY };

    const menuWidth = 300;
    const menuHeight = 400;
    const padding = 16;

    let left = anchorX;
    let top = anchorY;

    // Adjust horizontal position
    if (left + menuWidth > window.innerWidth - padding) {
      left = window.innerWidth - menuWidth - padding;
    }

    // Adjust vertical position
    if (top + menuHeight > window.innerHeight - padding) {
      top = window.innerHeight - menuHeight - padding;
    }

    return { left: Math.max(padding, left), top: Math.max(padding, top) };
  }, [anchorX, anchorY]);

  // Handle shape selection: click starts drag-to-draw; Shift+click keeps explicit instant insert.
  const handleShapeSelect = useCallback(
    (shapeType: ShapeType, e: React.MouseEvent) => {
      if (e.shiftKey) {
        dispatch('INSERT_SHAPE', { shapeType });
      } else {
        dispatch('START_SHAPE_INSERT', { shapeType });
      }
      closeShapesMenu();
    },
    [dispatch, closeShapesMenu],
  );

  // Close on escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeShapesMenu();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeShapesMenu]);

  // Close on click outside
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        closeShapesMenu();
      }
    },
    [closeShapesMenu],
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-ss-overlay" onClick={handleOverlayClick}>
      <div
        ref={menuRef}
        className="absolute bg-ss-surface rounded-ss-lg shadow-ss-lg border border-ss-border p-3 min-w-[280px] max-w-[360px] z-ss-modal"
        style={{
          left: menuPosition.left,
          top: menuPosition.top,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-dropdown-header font-semibold text-ss-text-secondary uppercase tracking-wide mb-2">
          Shapes
        </div>

        <div className="max-h-[340px] overflow-y-auto">
          {SHAPE_CATEGORIES.map((category) => (
            <div key={category.name} className="mb-3 last:mb-0">
              <div className="text-ribbon-group font-medium text-ss-text-tertiary mb-1.5 pl-1">
                {category.name}
              </div>
              <div className="grid grid-cols-5 gap-1">
                {category.shapes.map((shape) => (
                  <button
                    key={shape.type}
                    type="button"
                    title={shape.label}
                    className="flex items-center justify-center w-10 h-10 p-0 border border-transparent rounded bg-transparent cursor-pointer transition-all duration-ss-fast text-ss-text-secondary hover:bg-ss-surface-tertiary hover:border-ss-border"
                    onClick={(e) => handleShapeSelect(shape.type, e)}
                  >
                    <ShapePreviewThumbnail shapeType={shape.type} width={24} height={24} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
