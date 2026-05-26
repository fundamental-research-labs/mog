/**
 * Help Utilities
 *
 * Pure functions for opening help documentation.
 * Shared by global help shortcuts and UI actions.
 *
 * @module infra/utils/help
 */

// =============================================================================
// Constants
// =============================================================================

/**
 * External URLs for help resources.
 * These are placeholder URLs that should be updated to point to actual documentation.
 */
export const HELP_URLS = {
  /** Main help documentation */
  help: 'https://docs.example.com/spreadsheet',
  /** Support contact page or email */
  support: 'mailto:support@example.com',
  /** Changelog / release notes */
  whatsNew: 'https://docs.example.com/changelog',
} as const;

// =============================================================================
// Functions
// =============================================================================

/**
 * Opens the help documentation in a new browser tab.
 * Used by the F1 keyboard shortcut handler and the Help ribbon button.
 */
export function openHelp(): void {
  window.open(HELP_URLS.help, '_blank', 'noopener,noreferrer');
}
