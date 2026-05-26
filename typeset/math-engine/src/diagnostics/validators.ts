/**
 * Validators
 *
 * Validate OMML strings and MathAST nodes for correctness and completeness.
 */

import type {
  MathNode,
  SubscriptNode,
  SuperscriptNode,
} from '@mog-sdk/contracts/equation/omml-ast';
import { parseOMML } from '../parser/omml-parser';

export interface ValidationResult {
  valid: boolean;
  ast?: MathNode[];
  issues: ValidationIssue[];
  metrics: {
    nodeCount: number;
    depth: number;
    complexity: number;
  };
}

export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  path?: string;
}

/**
 * Validate an OMML XML string.
 * Parses the OMML and checks for structural issues.
 */
export function validateOMML(omml: string): ValidationResult {
  if (!omml || !omml.trim()) {
    return {
      valid: false,
      issues: [
        { code: 'EQUATION_OMML_PARSE_ERROR', severity: 'error', message: 'Empty OMML input' },
      ],
      metrics: { nodeCount: 0, depth: 0, complexity: 0 },
    };
  }

  const parseResult = parseOMML(omml);

  if (!parseResult.ok) {
    return {
      valid: false,
      issues: [
        {
          code: 'EQUATION_OMML_PARSE_ERROR',
          severity: 'error',
          message: parseResult.error.message,
          path: parseResult.error.location,
        },
      ],
      metrics: { nodeCount: 0, depth: 0, complexity: 0 },
    };
  }

  const ast = parseResult.value;
  const astIssues = validateASTNodes(ast, '');
  const metrics = computeMetrics(ast);

  return {
    valid: astIssues.filter((i) => i.severity === 'error').length === 0,
    ast,
    issues: astIssues,
    metrics,
  };
}

/**
 * Validate a MathAST node array.
 * Checks for empty fractions, missing bases, etc.
 */
export function validateAST(nodes: MathNode[]): {
  valid: boolean;
  issues: ValidationIssue[];
} {
  const issues = validateASTNodes(nodes, '');
  return {
    valid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  };
}

function validateASTNodes(nodes: MathNode[], path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const nodePath = `${path}/${node.type}[${i}]`;
    issues.push(...validateSingleNode(node, nodePath));
  }

  return issues;
}

function validateSingleNode(node: MathNode, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  switch (node.type) {
    case 'f':
      if (node.num.length === 0) {
        issues.push({
          code: 'EQUATION_EMPTY_NUMERATOR',
          severity: 'warning',
          message: 'Fraction has empty numerator',
          path,
        });
      }
      if (node.den.length === 0) {
        issues.push({
          code: 'EQUATION_EMPTY_DENOMINATOR',
          severity: 'warning',
          message: 'Fraction has empty denominator',
          path,
        });
      }
      issues.push(...validateASTNodes(node.num, `${path}/num`));
      issues.push(...validateASTNodes(node.den, `${path}/den`));
      break;

    case 'rad':
      if (node.e.length === 0) {
        issues.push({
          code: 'EQUATION_EMPTY_RADICAND',
          severity: 'warning',
          message: 'Radical has empty radicand',
          path,
        });
      }
      issues.push(...validateASTNodes(node.e, `${path}/e`));
      issues.push(...validateASTNodes(node.deg, `${path}/deg`));
      break;

    case 'sSup':
      if (node.e.length === 0) {
        issues.push({
          code: 'EQUATION_EMPTY_BASE',
          severity: 'warning',
          message: 'Superscript has empty base',
          path,
        });
      }
      issues.push(...validateASTNodes(node.e, `${path}/e`));
      issues.push(...validateASTNodes(node.sup, `${path}/sup`));
      break;

    case 'sSub':
      if (node.e.length === 0) {
        issues.push({
          code: 'EQUATION_EMPTY_BASE',
          severity: 'warning',
          message: 'Subscript has empty base',
          path,
        });
      }
      issues.push(...validateASTNodes(node.e, `${path}/e`));
      issues.push(...validateASTNodes(node.sub, `${path}/sub`));
      break;

    case 'sSubSup':
      issues.push(...validateASTNodes(node.e, `${path}/e`));
      issues.push(...validateASTNodes(node.sub, `${path}/sub`));
      issues.push(...validateASTNodes(node.sup, `${path}/sup`));
      break;

    case 'nary':
      issues.push(...validateASTNodes(node.sub, `${path}/sub`));
      issues.push(...validateASTNodes(node.sup, `${path}/sup`));
      issues.push(...validateASTNodes(node.e, `${path}/e`));
      break;

    case 'm':
      if (node.mr.length === 0) {
        issues.push({
          code: 'EQUATION_EMPTY_MATRIX',
          severity: 'warning',
          message: 'Matrix has no rows',
          path,
        });
      }
      for (let r = 0; r < node.mr.length; r++) {
        for (let c = 0; c < node.mr[r].length; c++) {
          issues.push(...validateASTNodes(node.mr[r][c], `${path}/mr[${r}][${c}]`));
        }
      }
      break;

    case 'd':
      for (let i = 0; i < node.e.length; i++) {
        issues.push(...validateASTNodes(node.e[i], `${path}/e[${i}]`));
      }
      break;

    case 'acc':
      issues.push(...validateASTNodes(node.e, `${path}/e`));
      break;

    case 'bar':
      issues.push(...validateASTNodes(node.e, `${path}/e`));
      break;

    case 'func':
      issues.push(...validateASTNodes(node.fName, `${path}/fName`));
      issues.push(...validateASTNodes(node.e, `${path}/e`));
      break;

    case 'limLow':
    case 'limUpp':
      issues.push(...validateASTNodes(node.e, `${path}/e`));
      issues.push(...validateASTNodes(node.lim, `${path}/lim`));
      break;

    case 'oMath':
      issues.push(...validateASTNodes(node.children, `${path}/children`));
      break;

    case 'oMathPara':
      for (let i = 0; i < node.equations.length; i++) {
        issues.push(...validateASTNodes(node.equations[i].children, `${path}/eq[${i}]`));
      }
      break;

    case 'box':
    case 'borderBox':
    case 'groupChr':
    case 'phant':
      issues.push(...validateASTNodes(node.e, `${path}/e`));
      break;

    case 'eqArr':
      for (let i = 0; i < node.e.length; i++) {
        issues.push(...validateASTNodes(node.e[i], `${path}/e[${i}]`));
      }
      break;

    case 'sPre':
      issues.push(...validateASTNodes(node.sub, `${path}/sub`));
      issues.push(...validateASTNodes(node.sup, `${path}/sup`));
      issues.push(...validateASTNodes(node.e, `${path}/e`));
      break;

    case 'r':
      // Text nodes are always valid
      break;
  }

  return issues;
}

function computeMetrics(nodes: MathNode[]): {
  nodeCount: number;
  depth: number;
  complexity: number;
} {
  let nodeCount = 0;
  let maxDepth = 0;
  let complexity = 0;

  function walk(node: MathNode, depth: number): void {
    nodeCount++;
    maxDepth = Math.max(maxDepth, depth);

    // Complexity: certain node types add more complexity
    switch (node.type) {
      case 'f':
        complexity += 2;
        node.num.forEach((n) => walk(n, depth + 1));
        node.den.forEach((n) => walk(n, depth + 1));
        break;
      case 'rad':
        complexity += 2;
        node.deg.forEach((n) => walk(n, depth + 1));
        node.e.forEach((n) => walk(n, depth + 1));
        break;
      case 'nary':
        complexity += 3;
        node.sub.forEach((n) => walk(n, depth + 1));
        node.sup.forEach((n) => walk(n, depth + 1));
        node.e.forEach((n) => walk(n, depth + 1));
        break;
      case 'm':
        complexity += node.mr.length * 2;
        node.mr.forEach((row) => row.forEach((cell) => cell.forEach((n) => walk(n, depth + 1))));
        break;
      case 'oMath':
        node.children.forEach((n) => walk(n, depth + 1));
        break;
      case 'sSub':
        complexity += 1;
        node.e.forEach((n) => walk(n, depth + 1));
        (node as SubscriptNode).sub.forEach((n) => walk(n, depth + 1));
        break;
      case 'sSup':
        complexity += 1;
        node.e.forEach((n) => walk(n, depth + 1));
        (node as SuperscriptNode).sup.forEach((n) => walk(n, depth + 1));
        break;
      case 'sSubSup':
        complexity += 2;
        node.e.forEach((n) => walk(n, depth + 1));
        node.sub.forEach((n) => walk(n, depth + 1));
        node.sup.forEach((n) => walk(n, depth + 1));
        break;
      case 'd':
        complexity += 1;
        node.e.forEach((group) => group.forEach((n) => walk(n, depth + 1)));
        break;
      case 'acc':
      case 'bar':
      case 'box':
      case 'borderBox':
      case 'groupChr':
      case 'phant':
        complexity += 1;
        node.e.forEach((n) => walk(n, depth + 1));
        break;
      case 'func':
        complexity += 1;
        node.fName.forEach((n) => walk(n, depth + 1));
        node.e.forEach((n) => walk(n, depth + 1));
        break;
      case 'limLow':
      case 'limUpp':
        complexity += 1;
        node.e.forEach((n) => walk(n, depth + 1));
        node.lim.forEach((n) => walk(n, depth + 1));
        break;
      case 'eqArr':
        complexity += node.e.length;
        node.e.forEach((row) => row.forEach((n) => walk(n, depth + 1)));
        break;
      case 'sPre':
        complexity += 2;
        node.sub.forEach((n) => walk(n, depth + 1));
        node.sup.forEach((n) => walk(n, depth + 1));
        node.e.forEach((n) => walk(n, depth + 1));
        break;
      case 'oMathPara':
        node.equations.forEach((eq) => eq.children.forEach((n) => walk(n, depth + 1)));
        break;
      case 'r':
        // Leaf node
        break;
    }
  }

  for (const node of nodes) {
    walk(node, 0);
  }

  return { nodeCount, depth: maxDepth, complexity };
}
