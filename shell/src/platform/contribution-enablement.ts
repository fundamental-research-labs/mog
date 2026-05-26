/**
 * Declarative enablement predicate evaluator.
 *
 * Evaluates simple expression strings against a read-only context snapshot.
 * No eval(), no new Function() — the expression is parsed structurally.
 *
 * Supported operators: ==, !=, >, <, >=, <=, &&, ||, !
 * Supported literals: true, false, numbers, single-quoted strings
 * Property access: bare identifiers resolve against the context object.
 *
 * This module is pure TypeScript with zero React dependencies.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EnablementContext {
  readonly activeAppId?: string;
  readonly activeResourceKind?: string;
  readonly selectionCount?: number;
  readonly hasClipboard?: boolean;
  readonly [key: string]: unknown;
}

/**
 * Evaluate a declarative enablement predicate against a context.
 * Returns false on any parse or evaluation error (safe failure).
 */
export function evaluateEnablementPredicate(
  predicate: string,
  context: EnablementContext,
): boolean {
  try {
    const tokens = tokenize(predicate.trim());
    const parser = new Parser(tokens, context);
    const result = parser.parseExpression();
    // Must have consumed all tokens
    if (parser.pos < tokens.length) {
      return false;
    }
    return Boolean(result);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'identifier'
  | 'op'
  | 'not'
  | 'lparen'
  | 'rparen';

interface Token {
  kind: TokenKind;
  value: string;
}

const OPERATORS = ['==', '!=', '>=', '<=', '&&', '||', '>', '<'] as const;

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (input[i] === ' ' || input[i] === '\t') {
      i++;
      continue;
    }

    // Parentheses
    if (input[i] === '(') {
      tokens.push({ kind: 'lparen', value: '(' });
      i++;
      continue;
    }
    if (input[i] === ')') {
      tokens.push({ kind: 'rparen', value: ')' });
      i++;
      continue;
    }

    // Two-character operators (must check before single-char)
    if (i + 1 < input.length) {
      const two = input[i] + input[i + 1];
      if (OPERATORS.includes(two as (typeof OPERATORS)[number])) {
        tokens.push({ kind: 'op', value: two });
        i += 2;
        continue;
      }
    }

    // Negation
    if (input[i] === '!') {
      tokens.push({ kind: 'not', value: '!' });
      i++;
      continue;
    }

    // Single-character operators
    if (input[i] === '>' || input[i] === '<') {
      tokens.push({ kind: 'op', value: input[i] });
      i++;
      continue;
    }

    // Single-quoted string literal
    if (input[i] === "'") {
      let str = '';
      i++; // skip opening quote
      while (i < input.length && input[i] !== "'") {
        if (input[i] === '\\' && i + 1 < input.length) {
          str += input[i + 1];
          i += 2;
        } else {
          str += input[i];
          i++;
        }
      }
      if (i >= input.length) throw new Error('Unterminated string');
      i++; // skip closing quote
      tokens.push({ kind: 'string', value: str });
      continue;
    }

    // Number literal
    if (input[i] >= '0' && input[i] <= '9') {
      let num = '';
      while (i < input.length && ((input[i] >= '0' && input[i] <= '9') || input[i] === '.')) {
        num += input[i];
        i++;
      }
      tokens.push({ kind: 'number', value: num });
      continue;
    }

    // Identifier or boolean keyword
    if (isIdentStart(input[i])) {
      let ident = '';
      while (i < input.length && isIdentChar(input[i])) {
        ident += input[i];
        i++;
      }
      if (ident === 'true' || ident === 'false') {
        tokens.push({ kind: 'boolean', value: ident });
      } else {
        tokens.push({ kind: 'identifier', value: ident });
      }
      continue;
    }

    throw new Error(`Unexpected character: ${input[i]}`);
  }

  return tokens;
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isIdentChar(ch: string): boolean {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}

// ---------------------------------------------------------------------------
// Recursive descent parser
// ---------------------------------------------------------------------------

class Parser {
  pos = 0;
  private readonly tokens: Token[];
  private readonly context: EnablementContext;

  constructor(tokens: Token[], context: EnablementContext) {
    this.tokens = tokens;
    this.context = context;
  }

  parseExpression(): unknown {
    return this.parseOr();
  }

  private parseOr(): unknown {
    let left = this.parseAnd();
    while (this.match('op', '||')) {
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  private parseAnd(): unknown {
    let left = this.parseComparison();
    while (this.match('op', '&&')) {
      const right = this.parseComparison();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  private parseComparison(): unknown {
    let left = this.parseUnary();

    if (this.pos < this.tokens.length && this.tokens[this.pos].kind === 'op') {
      const op = this.tokens[this.pos].value;
      if (['==', '!=', '>', '<', '>=', '<='].includes(op)) {
        this.pos++;
        const right = this.parseUnary();
        return applyComparison(op, left, right);
      }
    }

    return left;
  }

  private parseUnary(): unknown {
    if (this.match('not', '!')) {
      const operand = this.parseUnary();
      return !operand;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): unknown {
    const token = this.tokens[this.pos];
    if (!token) throw new Error('Unexpected end of expression');

    if (token.kind === 'lparen') {
      this.pos++;
      const result = this.parseExpression();
      if (!this.match('rparen', ')')) {
        throw new Error('Expected closing parenthesis');
      }
      return result;
    }

    if (token.kind === 'boolean') {
      this.pos++;
      return token.value === 'true';
    }

    if (token.kind === 'number') {
      this.pos++;
      return Number(token.value);
    }

    if (token.kind === 'string') {
      this.pos++;
      return token.value;
    }

    if (token.kind === 'identifier') {
      this.pos++;
      return this.context[token.value];
    }

    throw new Error(`Unexpected token: ${token.value}`);
  }

  private match(kind: TokenKind, value: string): boolean {
    if (
      this.pos < this.tokens.length &&
      this.tokens[this.pos].kind === kind &&
      this.tokens[this.pos].value === value
    ) {
      this.pos++;
      return true;
    }
    return false;
  }
}

function applyComparison(op: string, left: unknown, right: unknown): boolean {
  switch (op) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
      return (left as number) > (right as number);
    case '<':
      return (left as number) < (right as number);
    case '>=':
      return (left as number) >= (right as number);
    case '<=':
      return (left as number) <= (right as number);
    default:
      return false;
  }
}
