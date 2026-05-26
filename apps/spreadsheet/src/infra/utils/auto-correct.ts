/**
 * Auto-Correct Utilities
 *
 * I.3: Auto-correct features for editing.
 * Provides common text corrections that can be applied during cell editing.
 *
 * Features:
 * - Common misspellings correction
 * - Smart quotes conversion (straight to curly)
 * - Capitalize first letter of sentences
 * - Hyperlink detection and formatting
 *
 * Design:
 * - All corrections are optional and configurable
 * - Returns the corrected text without modifying state
 * - Designed to be called during commit or as-you-type
 *
 */

// =============================================================================
// TYPES
// =============================================================================

export interface AutoCorrectOptions {
  /** Enable common misspelling corrections */
  correctMisspellings: boolean;
  /** Convert straight quotes to curly quotes */
  smartQuotes: boolean;
  /** Capitalize first letter of sentence */
  capitalizeFirstLetter: boolean;
  /** Detect and mark URLs as hyperlinks */
  detectHyperlinks: boolean;
}

export interface AutoCorrectResult {
  /** The corrected text */
  text: string;
  /** Whether any corrections were made */
  wasModified: boolean;
  /** List of corrections that were applied */
  corrections: string[];
  /** Detected hyperlinks (if detectHyperlinks is enabled) */
  detectedUrls: string[];
}

// =============================================================================
// DEFAULT OPTIONS
// =============================================================================

export const DEFAULT_AUTO_CORRECT_OPTIONS: AutoCorrectOptions = {
  correctMisspellings: true,
  smartQuotes: false, // Off by default - can be annoying for code/formulas
  capitalizeFirstLetter: true,
  detectHyperlinks: true,
};

// =============================================================================
// COMMON MISSPELLINGS
// =============================================================================

/**
 * Common English misspellings and their corrections.
 * This list can be expanded or loaded from a configuration file.
 */
const COMMON_MISSPELLINGS: Record<string, string> = {
  // Common typos
  teh: 'the',
  thier: 'their',
  recieve: 'receive',
  seperate: 'separate',
  occured: 'occurred',
  occuring: 'occurring',
  accomodate: 'accommodate',
  acheive: 'achieve',
  accross: 'across',
  adress: 'address',
  agregate: 'aggregate',
  apparant: 'apparent',
  aproximate: 'approximate',
  arguement: 'argument',
  basicly: 'basically',
  begining: 'beginning',
  beleive: 'believe',
  buisness: 'business',
  calender: 'calendar',
  catagory: 'category',
  comittee: 'committee',
  completly: 'completely',
  concensus: 'consensus',
  consistant: 'consistent',
  definately: 'definitely',
  desparate: 'desperate',
  dissapear: 'disappear',
  embarass: 'embarrass',
  enviroment: 'environment',
  explaination: 'explanation',
  facsinate: 'fascinate',
  foriegn: 'foreign',
  goverment: 'government',
  gaurd: 'guard',
  harrass: 'harass',
  immediatly: 'immediately',
  independant: 'independent',
  judgement: 'judgment',
  knowlege: 'knowledge',
  liason: 'liaison',
  maintenence: 'maintenance',
  managment: 'management',
  manuever: 'maneuver',
  millenium: 'millennium',
  miniscule: 'minuscule',
  mispell: 'misspell',
  necesary: 'necessary',
  neccessary: 'necessary',
  noticable: 'noticeable',
  occurence: 'occurrence',
  pastime: 'pastime',
  perseverence: 'perseverance',
  personel: 'personnel',
  posession: 'possession',
  preceed: 'precede',
  privelege: 'privilege',
  probaly: 'probably',
  pronounciation: 'pronunciation',
  publically: 'publicly',
  recomend: 'recommend',
  refered: 'referred',
  relevent: 'relevant',
  religous: 'religious',
  rythm: 'rhythm',
  succesful: 'successful',
  supercede: 'supersede',
  suprise: 'surprise',
  tommorrow: 'tomorrow',
  truely: 'truly',
  untill: 'until',
  wierd: 'weird',
};

// =============================================================================
// SMART QUOTES
// =============================================================================

/**
 * Convert straight quotes to curly/smart quotes.
 *
 * @param text - Input text
 * @returns Text with smart quotes
 */
function applySmartQuotes(text: string): string {
  let result = text;

  // Double quotes
  // Opening: after whitespace, start of string, or opening bracket
  result = result.replace(/(^|[\s([{])"/g, '$1\u201C'); // Opening double quote
  result = result.replace(/"/g, '\u201D'); // Closing double quote

  // Single quotes / apostrophes
  // Opening: after whitespace, start of string, or opening bracket
  result = result.replace(/(^|[\s([{])'/g, '$1\u2018'); // Opening single quote
  result = result.replace(/'/g, '\u2019'); // Closing single quote / apostrophe

  return result;
}

// =============================================================================
// CAPITALIZATION
// =============================================================================

/**
 * Capitalize the first letter of a sentence.
 *
 * @param text - Input text
 * @returns Text with first letter capitalized
 */
function capitalizeFirstLetter(text: string): string {
  if (!text) return text;

  // Capitalize first letter if the text doesn't start with a number or special char
  const firstChar = text.charAt(0);
  if (/[a-z]/.test(firstChar)) {
    return firstChar.toUpperCase() + text.slice(1);
  }

  return text;
}

// =============================================================================
// HYPERLINK DETECTION
// =============================================================================

/**
 * Regular expression for detecting URLs.
 * Matches http/https URLs and common patterns like www.
 */
const URL_PATTERN = /\b(https?:\/\/[^\s<>"\])+|www\.[^\s<>"\]]+\.[a-z]{2,}(?:\/[^\s<>"\]]*)?)/gi;

/**
 * Detect URLs in text.
 *
 * @param text - Input text
 * @returns Array of detected URLs
 */
function detectUrls(text: string): string[] {
  const matches = text.match(URL_PATTERN);
  return matches ? [...new Set(matches)] : [];
}

// =============================================================================
// MISSPELLING CORRECTION
// =============================================================================

/**
 * Correct common misspellings in text.
 * Uses word boundary matching to avoid partial word corrections.
 *
 * @param text - Input text
 * @returns Object with corrected text and list of corrections
 */
function correctMisspellings(text: string): { text: string; corrections: string[] } {
  const corrections: string[] = [];
  let result = text;

  for (const [misspelling, correction] of Object.entries(COMMON_MISSPELLINGS)) {
    // Create regex with word boundaries (case insensitive)
    const regex = new RegExp(`\\b${misspelling}\\b`, 'gi');

    if (regex.test(result)) {
      // Preserve original casing pattern
      result = result.replace(regex, (match) => {
        corrections.push(`${match} -> ${preserveCase(match, correction)}`);
        return preserveCase(match, correction);
      });
    }
  }

  return { text: result, corrections };
}

/**
 * Preserve the case pattern of the original word when replacing.
 *
 * @param original - Original word (with casing to preserve)
 * @param replacement - Replacement word
 * @returns Replacement with matching case pattern
 */
function preserveCase(original: string, replacement: string): string {
  // All uppercase
  if (original === original.toUpperCase()) {
    return replacement.toUpperCase();
  }

  // Title case (first letter upper)
  if (original.charAt(0) === original.charAt(0).toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase();
  }

  // All lowercase
  return replacement.toLowerCase();
}

// =============================================================================
// MAIN AUTO-CORRECT FUNCTION
// =============================================================================

/**
 * Apply auto-correct to text based on options.
 *
 * @param text - Input text to correct
 * @param options - Auto-correct options (defaults to DEFAULT_AUTO_CORRECT_OPTIONS)
 * @returns AutoCorrectResult with corrected text and metadata
 *
 * @example
 * ```typescript
 * const result = autoCorrect('teh quick brown fox', {
 * correctMisspellings: true,
 * smartQuotes: false,
 * capitalizeFirstLetter: true,
 * detectHyperlinks: false
 * });
 * // result.text === 'The quick brown fox'
 * // result.wasModified === true
 * // result.corrections === ['teh -> the']
 * ```
 */
export function autoCorrect(
  text: string,
  options: Partial<AutoCorrectOptions> = {},
): AutoCorrectResult {
  const opts: AutoCorrectOptions = { ...DEFAULT_AUTO_CORRECT_OPTIONS, ...options };
  let result = text;
  const allCorrections: string[] = [];
  let detectedUrls: string[] = [];

  // Skip auto-correct for formulas
  if (text.startsWith('=')) {
    return {
      text,
      wasModified: false,
      corrections: [],
      detectedUrls: [],
    };
  }

  // 1. Correct misspellings
  if (opts.correctMisspellings) {
    const { text: corrected, corrections } = correctMisspellings(result);
    result = corrected;
    allCorrections.push(...corrections);
  }

  // 2. Apply smart quotes
  if (opts.smartQuotes) {
    const before = result;
    result = applySmartQuotes(result);
    if (result !== before) {
      allCorrections.push('smart quotes applied');
    }
  }

  // 3. Capitalize first letter
  if (opts.capitalizeFirstLetter) {
    const before = result;
    result = capitalizeFirstLetter(result);
    if (result !== before) {
      allCorrections.push('capitalized first letter');
    }
  }

  // 4. Detect hyperlinks
  if (opts.detectHyperlinks) {
    detectedUrls = detectUrls(result);
  }

  return {
    text: result,
    wasModified: result !== text,
    corrections: allCorrections,
    detectedUrls,
  };
}

/**
 * Check if a single word is a common misspelling.
 * Useful for as-you-type correction.
 *
 * @param word - Word to check
 * @returns Correction if misspelled, undefined otherwise
 */
export function getCorrection(word: string): string | undefined {
  const lowerWord = word.toLowerCase();
  const correction = COMMON_MISSPELLINGS[lowerWord];

  if (correction) {
    return preserveCase(word, correction);
  }

  return undefined;
}

/**
 * Check if text contains a URL.
 *
 * @param text - Text to check
 * @returns true if text contains a URL
 */
export function containsUrl(text: string): boolean {
  return URL_PATTERN.test(text);
}

/**
 * Add a custom misspelling correction.
 * Useful for user-defined corrections.
 *
 * @param misspelling - Misspelled word
 * @param correction - Correct spelling
 */
export function addCustomCorrection(misspelling: string, correction: string): void {
  COMMON_MISSPELLINGS[misspelling.toLowerCase()] = correction.toLowerCase();
}
