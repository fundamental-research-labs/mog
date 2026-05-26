/**
 * Culture Type Guard Functions
 *
 * Extracted from @mog-sdk/contracts/culture.
 */

import type { SupportedCultureName } from '@mog-sdk/contracts/culture';

/**
 * Check if a string is a supported culture name.
 */
export function isSupportedCultureName(name: string): name is SupportedCultureName {
  return [
    'en-US',
    'en-GB',
    'de-DE',
    'fr-FR',
    'es-ES',
    'it-IT',
    'pt-BR',
    'ja-JP',
    'zh-CN',
    'ko-KR',
  ].includes(name);
}
