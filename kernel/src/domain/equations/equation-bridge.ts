/**
 * Equation Bridge Implementation
 *
 * Provides equation parsing and manipulation services.
 * Implements IEquationBridge interface from contracts.
 *
 * Uses singleton pattern like calculator-bridge.ts for consistency.
 *
 * ARCHITECTURE: Bridge Pattern (Section 9 of Architecture Checklist)
 * - Interface defined in contracts/src/bridges/equation-bridge.ts
 * - Implementation here
 * - Access via getEquationBridge() singleton
 *
 * @see contracts/src/bridges/equation-bridge.ts - Interface
 */

import type { IEquationBridge } from '@mog-sdk/contracts/bridges';
import type { EquationParseError, MathNode, Result } from '@mog-sdk/contracts/equation';

import { parseLatex, parseOMML } from '@mog/math-engine';

// =============================================================================
// Bridge Implementation
// =============================================================================

export class EquationBridge implements IEquationBridge {
  /**
   * Parse OMML XML string to MathNode AST.
   *
   * Used for importing equations from XLSX files.
   * Delegates to internal parser.
   *
   * @param omml - OMML XML string
   * @returns Result with MathNode[] AST or EquationParseError
   */
  parseOmml(omml: string): Result<MathNode[], EquationParseError> {
    return parseOMML(omml);
  }

  /**
   * Parse LaTeX string to MathNode AST.
   *
   * Used for user input in Equation Editor dialog.
   * Supports a subset of LaTeX sufficient for common equations.
   *
   * @param latex - LaTeX math string (e.g., "\\frac{1}{2}")
   * @returns Result with MathNode[] AST or EquationParseError
   *
   */
  parseLatex(latex: string): Result<MathNode[], EquationParseError> {
    return parseLatex(latex);
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    // No cleanup needed for stateless bridge
  }
}

// =============================================================================
// Singleton Instance (following calculator-bridge.ts pattern)
// =============================================================================

let bridgeInstance: EquationBridge | null = null;

/**
 * Get the singleton equation bridge instance.
 *
 * @returns EquationBridge instance
 *
 * @example
 * ```typescript
 * const bridge = getEquationBridge();
 * const result = bridge.parseOmml(ommlXml);
 * if (result.ok) {
 *   console.log('Parsed:', result.value);
 * } else {
 *   console.error('Error:', result.error);
 * }
 * ```
 */
export function getEquationBridge(): EquationBridge {
  if (!bridgeInstance) {
    bridgeInstance = new EquationBridge();
  }
  return bridgeInstance;
}

/**
 * Reset the equation bridge (for testing).
 *
 * Creates a fresh bridge instance on next getEquationBridge() call.
 */
export function resetEquationBridge(): void {
  bridgeInstance?.destroy();
  bridgeInstance = null;
}
