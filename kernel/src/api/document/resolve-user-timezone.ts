/**
 * Session userTimezone resolution at the public document/workbook bootstrap seam.
 *
 * Browser is the only environment where reading the host's `Intl` is safe:
 * the browser tab IS the user's device, so its timezone is the user's
 * calendar frame. Headless Node, cloud workers, and agent runtimes must
 * carry the user's TZ explicitly via session metadata — host TZ is
 * meaningless when the host is not the user's machine.
 *
 */

import { KernelError } from '../../errors';

/**
 * Resolve the IANA timezone name for the document/workbook session.
 *
 * @param explicit  caller-provided timezone name; when set, used as-is.
 * @param environment  'browser' permits Intl auto-resolution; 'headless' does not.
 * @returns the resolved timezone name (e.g. `'America/Los_Angeles'`, `'UTC'`).
 * @throws KernelError(`CONFIG_INVALID_USER_TIMEZONE`) if explicit is provided but invalid.
 * @throws KernelError(`CONFIG_MISSING_USER_TIMEZONE`) if explicit is absent and no safe default exists.
 */
export function resolveUserTimezone(
  explicit: string | undefined,
  environment: 'browser' | 'headless',
): string {
  if (explicit !== undefined) {
    if (typeof explicit !== 'string' || explicit.length === 0) {
      throw new KernelError(
        'CONFIG_INVALID_USER_TIMEZONE',
        `userTimezone must be a non-empty IANA timezone name; got ${JSON.stringify(explicit)}.`,
      );
    }
    return explicit;
  }
  if (environment === 'browser' && typeof Intl !== 'undefined') {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  // Headless environments default to UTC for deterministic execution.
  // The host process TZ is meaningless when the host is not the user's device.
  if (environment === 'headless') {
    return 'UTC';
  }
  throw new KernelError(
    'CONFIG_MISSING_USER_TIMEZONE',
    'A userTimezone is required in non-browser environments without a headless runtime.',
    {
      suggestion:
        "Pass userTimezone explicitly (e.g. 'UTC' for tests, the agent owner's TZ for cloud workers).",
    },
  );
}
