/**
 * Layers Index
 *
 * Export all layer components for SpreadsheetApp.
 * Layers are logical groupings of UI elements that can be rendered independently.
 *
 * Architecture:
 * - DialogLayer: All 60+ modal dialogs (render at root level, use portals)
 * - OverlayLayer: Context menus, popovers, floating UI (render in grid container)
 * - PanelLayer: Side panels (render in grid container, overlay grid)
 *
 */

export { DialogLayer } from './DialogLayer';
export { OverlayLayer } from './OverlayLayer';
export { PanelLayer, type PanelLayerProps } from './PanelLayer';
export {
  registerSpreadsheetPanelContribution,
  useSpreadsheetPanelContributions,
  type SpreadsheetPanelContribution,
} from './panel-contributions';
export { RemoteCursorLayer } from '../collab/RemoteCursorLayer';
