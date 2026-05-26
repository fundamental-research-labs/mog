/**
 * Round-Trip Checker
 *
 * Verifies that OMML -> AST -> OMML -> AST produces equivalent ASTs.
 * This is critical for ensuring no information is lost in parsing/serialization.
 */

import type { MathNode } from '@mog-sdk/contracts/equation/omml-ast';
import { astToOmml } from '../converter/latex-to-omml';
import { parseOMML } from '../parser/omml-parser';
import type { Difference } from './comparators';
import { compareEquations } from './comparators';

export interface RoundTripResult {
  /** Whether the round-trip preserves the equation structure */
  preserves: boolean;
  /** Original OMML string */
  original: string;
  /** Round-tripped OMML string */
  roundTripped: string;
  /** Differences found between original and round-tripped ASTs */
  differences: Difference[];
  /** Original AST (if parsing succeeded) */
  originalAst?: MathNode[];
  /** Round-tripped AST (if parsing succeeded) */
  roundTrippedAst?: MathNode[];
}

/**
 * Check round-trip fidelity of an OMML string.
 * Pipeline: OMML -> AST -> OMML -> AST, compare first and second ASTs.
 */
export function roundTripCheck(omml: string): RoundTripResult {
  // Step 1: Parse original OMML
  const firstParse = parseOMML(omml);
  if (!firstParse.ok) {
    return {
      preserves: false,
      original: omml,
      roundTripped: '',
      differences: [
        {
          path: '',
          type: 'value_mismatch',
          expected: 'valid OMML',
          actual: `parse error: ${firstParse.error.message}`,
        },
      ],
    };
  }

  // Step 2: Serialize AST back to OMML
  const rawOmml = astToOmml(firstParse.value);
  // Wrap in oMath to ensure a single root element for re-parsing when there are multiple roots
  const regeneratedOmml =
    firstParse.value.length > 1 &&
    firstParse.value[0]?.type !== 'oMath' &&
    firstParse.value[0]?.type !== 'oMathPara'
      ? '<m:oMath>' + rawOmml + '</m:oMath>'
      : rawOmml;

  // Step 3: Parse the regenerated OMML
  const secondParse = parseOMML(regeneratedOmml);
  if (!secondParse.ok) {
    return {
      preserves: false,
      original: omml,
      roundTripped: regeneratedOmml,
      differences: [
        {
          path: '',
          type: 'value_mismatch',
          expected: 'valid re-parsed OMML',
          actual: `re-parse error: ${secondParse.error.message}`,
        },
      ],
      originalAst: firstParse.value,
    };
  }

  // Step 4: Compare ASTs
  const comparison = compareEquations(firstParse.value, secondParse.value);

  return {
    preserves: comparison.match,
    original: omml,
    roundTripped: regeneratedOmml,
    differences: comparison.differences,
    originalAst: firstParse.value,
    roundTrippedAst: secondParse.value,
  };
}
