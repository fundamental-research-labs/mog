/**
 * OMML AST Type Guard Functions
 *
 * Runtime type guards for narrowing MathNode union types.
 * Moved from @mog/spreadsheet-utils/equation/omml-ast.
 */

import type {
  DelimiterNode,
  FractionNode,
  MathNode,
  MathRun,
  MatrixNode,
  NaryNode,
  OMath,
  RadicalNode,
} from '@mog-sdk/contracts/equation/omml-ast';

export function isOMath(node: MathNode): node is OMath {
  return node.type === 'oMath';
}

export function isMathRun(node: MathNode): node is MathRun {
  return node.type === 'r';
}

export function isFraction(node: MathNode): node is FractionNode {
  return node.type === 'f';
}

export function isRadical(node: MathNode): node is RadicalNode {
  return node.type === 'rad';
}

export function isNary(node: MathNode): node is NaryNode {
  return node.type === 'nary';
}

export function isMatrix(node: MathNode): node is MatrixNode {
  return node.type === 'm';
}

export function isDelimiter(node: MathNode): node is DelimiterNode {
  return node.type === 'd';
}
