/**
 * HyperlinkTooltip
 *
 * Shows the hyperlink URL when hovering over a cell that contains a hyperlink.
 * Excel displays this as a tooltip showing the URL that the user will navigate to
 * if they click the cell.
 *
 * Architecture:
 * - Uses mouse hover state to track hovered cell
 * - Looks up hyperlink data from cell via getHyperlink()
 * - Positioned near the cursor via fixed positioning
 * - Shows after a 300ms debounce delay to prevent flicker
 * - No dispatch needed - tooltip is local UI state
 *
 * NOTE: Rendered as a plain fixed-position div (not a Radix Popover portal) so
 * it is synchronously visible in the DOM as soon as React commits the render.
 * Radix Portal delays mount to a microtask and CSS fade-in animations make the
 * element transiently invisible — both break the `readHyperlinkTooltip` test
 * helper that queries `[role="tooltip"]` with an opacity check.
 */

export interface HyperlinkTooltipProps {
  /** URL to display in the tooltip */
  url: string;
  /** Position of the tooltip (screen coordinates) */
  position: { x: number; y: number };
  /** Whether the tooltip is visible */
  visible: boolean;
}

/**
 * Hyperlink tooltip component.
 * Shows the URL for hyperlink cells when hovering.
 * Uses a neutral light background (Excel-style).
 */
export function HyperlinkTooltip({ url, position, visible }: HyperlinkTooltipProps) {
  if (!url || !visible) return null;

  // Truncate very long URLs for display
  const displayUrl = url.length > 100 ? url.slice(0, 97) + '...' : url;

  return (
    <div
      role="tooltip"
      data-testid="hyperlink-tooltip"
      className="px-2 py-1.5 pointer-events-none max-w-[400px] bg-ss-surface-primary border border-ss-border-default text-body-sm rounded-ss-md shadow-ss-dropdown z-ss-tooltip"
      style={{ position: 'fixed', left: position.x, top: position.y }}
    >
      <div className="text-ss-text-secondary break-all">{displayUrl}</div>
      <div className="text-ss-text-tertiary text-ribbon-compact mt-0.5">Click to follow link</div>
    </div>
  );
}

export default HyperlinkTooltip;
