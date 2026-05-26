/**
 * HomeAlignmentIcons
 *
 * Icons for the Alignment group in the Home tab ribbon.
 * Includes text orientation and indent icons (H3, H4).
 */

// =============================================================================
// Text Orientation Icons (H3)
// =============================================================================

/**
 * Text orientation dropdown icon - ab with rotation indicator
 */
export function TextOrientationIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <text x="2" y="11" fontSize="8" fontWeight="600" transform="rotate(-45 8 8)">
        ab
      </text>
      <path d="M12 4l2-2v4l-2-2z" />
    </svg>
  );
}

/**
 * Angle counterclockwise icon (45°)
 */
export function AngleCounterclockwiseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <text x="3" y="12" fontSize="9" fontWeight="500" transform="rotate(-45 8 8)">
        Ab
      </text>
    </svg>
  );
}

/**
 * Angle clockwise icon (-45°)
 */
export function AngleClockwiseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <text x="3" y="12" fontSize="9" fontWeight="500" transform="rotate(45 8 8)">
        Ab
      </text>
    </svg>
  );
}

/**
 * Vertical text icon (text stacked vertically, Excel value: 255)
 */
export function VerticalTextIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <text x="6" y="6" fontSize="5" fontWeight="600">
        A
      </text>
      <text x="6" y="11" fontSize="5" fontWeight="600">
        b
      </text>
    </svg>
  );
}

/**
 * Rotate text up icon (90° counterclockwise)
 */
export function RotateTextUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <text x="4" y="12" fontSize="9" fontWeight="500" transform="rotate(-90 8 8)">
        Ab
      </text>
    </svg>
  );
}

/**
 * Rotate text down icon (90° clockwise)
 */
export function RotateTextDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <text x="4" y="12" fontSize="9" fontWeight="500" transform="rotate(90 8 8)">
        Ab
      </text>
    </svg>
  );
}

// =============================================================================
// Indent Icons (H4)
// =============================================================================

/**
 * Increase indent icon - lines with right arrow
 */
export function IncreaseIndentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6 4h8v1.5H6V4zm0 3h8v1.5H6V7zm0 3h8v1.5H6V10z" />
      <path d="M2 6l3 2-3 2V6z" />
    </svg>
  );
}

/**
 * Decrease indent icon - lines with left arrow
 */
export function DecreaseIndentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6 4h8v1.5H6V4zm0 3h8v1.5H6V7zm0 3h8v1.5H6V10z" />
      <path d="M5 6l-3 2 3 2V6z" />
    </svg>
  );
}
