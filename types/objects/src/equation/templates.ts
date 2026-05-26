/**
 * Equation Templates
 *
 * Pre-defined equation templates matching Excel's Equation gallery.
 */

/**
 * Template categories matching Excel
 */
export type EquationTemplateCategory =
  | 'recent'
  | 'fractions'
  | 'scripts'
  | 'radicals'
  | 'integrals'
  | 'large-operators'
  | 'brackets'
  | 'functions'
  | 'accents'
  | 'limits'
  | 'operators'
  | 'matrices';

/**
 * Equation template definition
 */
export interface EquationTemplate {
  id: string;
  name: string;
  category: EquationTemplateCategory;
  /** LaTeX representation (for display and editing) */
  latex: string;
  /** OMML representation (for storage) */
  omml: string;
  /** SVG thumbnail (base64 or data URL) */
  thumbnail: string;
  /** Placeholders that user should fill in */
  placeholders: string[];
}
