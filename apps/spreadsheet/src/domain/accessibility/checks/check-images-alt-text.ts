/**
 * Check Images Alt Text
 *
 * Checks for images (pictures) without alt text.
 * Screen readers cannot describe images without alt text.
 *
 * NOTE: Empty string is allowed (marks image as decorative per WCAG).
 * Only undefined/null alt text is flagged.
 *
 * Uses the Worksheet.objects API (FloatingObjectHandle) to list objects per sheet.
 * Since FloatingObjectHandle does not carry altText, all pictures are currently
 * flagged. When the API is extended with altText, update the check below.
 */

import type { AccessibilityIssue } from '@mog-sdk/contracts/accessibility';
import type { Worksheet } from '@mog-sdk/contracts/api';

import type { AccessibilityCheckContext } from './types';
import { generateIssueId } from './types';

/**
 * Check images for missing alt text.
 *
 * @param checkCtx - Accessibility check context
 * @param ws - Worksheet to check
 * @param sheetName - Sheet name for display
 * @returns Array of accessibility issues for images without alt text
 */
export async function checkImagesAltText(
  _checkCtx: AccessibilityCheckContext,
  ws: Worksheet,
  sheetName: string,
): Promise<AccessibilityIssue[]> {
  const sheetId = ws.getSheetId();
  const objects = await ws.objects.list();
  const issues: AccessibilityIssue[] = [];

  for (const obj of objects) {
    // Only check pictures (type === 'picture')
    if (obj.type !== 'picture') continue;

    // FloatingObjectInfo does not carry altText yet — flag all pictures.
    // TODO: When FloatingObjectInfo is extended with altText, check:
    // if (obj.altText === undefined || obj.altText === null)
    // Empty string is allowed (marks image as decorative per WCAG).
    issues.push({
      id: generateIssueId('missing-alt-text', sheetId, obj.id),
      severity: 'error',
      category: 'images',
      issueType: 'missing-alt-text',
      title: 'Missing alternative text',
      description: `Image "${obj.id}" has no alt text`,
      location: {
        sheetId,
        sheetName,
        type: 'object',
        objectId: obj.id,
      },
      recommendedAction:
        'Add alternative text that describes the image content, or set to empty string to mark as decorative',
      whyFix: 'Screen readers cannot describe images without alt text',
    });
  }

  return issues;
}
