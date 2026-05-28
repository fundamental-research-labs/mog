use super::MAX_DEPTH;
use super::ast::{CalcFieldExpr, CalcFieldOp};
use super::error::CalcFieldParseError;
use super::lexer::Token;

/// Parser state: wraps a token stream with a cursor.
struct Parser {
    tokens: Vec<Token>,
    pos: usize,
    depth: usize,
}

impl Parser {
    fn new(tokens: Vec<Token>) -> Self {
        Parser {
            tokens,
            pos: 0,
            depth: 0,
        }
    }

    /// Increment recursion depth, returning an error if the limit is exceeded.
    fn enter(&mut self) -> Result<(), CalcFieldParseError> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(CalcFieldParseError::MaxDepthExceeded {
                max_depth: MAX_DEPTH,
            });
        }
        Ok(())
    }

    /// Decrement recursion depth.
    fn leave(&mut self) {
        self.depth -= 1;
    }

    /// Peek at the current token without consuming it.
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    /// Consume the current token and advance.
    fn advance(&mut self) -> Option<Token> {
        if self.pos < self.tokens.len() {
            let tok = self.tokens[self.pos].clone();
            self.pos += 1;
            Some(tok)
        } else {
            None
        }
    }

    /// Parse an expression (entry point): handles `+` and `-` (lowest precedence).
    ///
    /// Grammar:
    /// ```text
    /// expr     = term (('+' | '-') term)*
    /// term     = unary (('*' | '/') unary)*
    /// unary    = '-' unary | primary
    /// primary  = NUMBER | IDENT | '(' expr ')'
    /// ```
    fn parse_expr(&mut self) -> Result<CalcFieldExpr, CalcFieldParseError> {
        self.enter()?;
        let mut left = self.parse_term()?;

        loop {
            match self.peek() {
                Some(Token::Plus) => {
                    self.advance();
                    let right = self.parse_term()?;
                    left = CalcFieldExpr::BinaryOp {
                        op: CalcFieldOp::Add,
                        left: Box::new(left),
                        right: Box::new(right),
                    };
                }
                Some(Token::Minus) => {
                    self.advance();
                    let right = self.parse_term()?;
                    left = CalcFieldExpr::BinaryOp {
                        op: CalcFieldOp::Sub,
                        left: Box::new(left),
                        right: Box::new(right),
                    };
                }
                _ => break,
            }
        }

        self.leave();
        Ok(left)
    }

    /// Parse a term: handles `*` and `/` (higher precedence than +/-).
    fn parse_term(&mut self) -> Result<CalcFieldExpr, CalcFieldParseError> {
        self.enter()?;
        let mut left = self.parse_unary()?;

        loop {
            match self.peek() {
                Some(Token::Star) => {
                    self.advance();
                    let right = self.parse_unary()?;
                    left = CalcFieldExpr::BinaryOp {
                        op: CalcFieldOp::Mul,
                        left: Box::new(left),
                        right: Box::new(right),
                    };
                }
                Some(Token::Slash) => {
                    self.advance();
                    let right = self.parse_unary()?;
                    left = CalcFieldExpr::BinaryOp {
                        op: CalcFieldOp::Div,
                        left: Box::new(left),
                        right: Box::new(right),
                    };
                }
                _ => break,
            }
        }

        self.leave();
        Ok(left)
    }

    /// Parse a unary expression: handles unary negation.
    fn parse_unary(&mut self) -> Result<CalcFieldExpr, CalcFieldParseError> {
        self.enter()?;
        let result = if let Some(Token::Minus) = self.peek() {
            self.advance();
            let inner = self.parse_unary()?;
            Ok(CalcFieldExpr::Negate(Box::new(inner)))
        } else {
            self.parse_primary()
        };
        self.leave();
        result
    }

    /// Parse a primary expression: number literal, field reference, or parenthesized expr.
    fn parse_primary(&mut self) -> Result<CalcFieldExpr, CalcFieldParseError> {
        self.enter()?;
        let result = match self.advance() {
            Some(Token::Number(n)) => Ok(CalcFieldExpr::Number(n)),
            Some(Token::Ident(name)) => Ok(CalcFieldExpr::FieldRef(name)),
            Some(Token::LParen) => {
                let paren_pos = self.pos; // position after consuming '('
                let inner = self.parse_expr()?;
                match self.advance() {
                    Some(Token::RParen) => Ok(inner),
                    Some(other) => Err(CalcFieldParseError::UnexpectedToken {
                        token: format!("{other:?}"),
                        position: self.pos,
                    }),
                    None => Err(CalcFieldParseError::UnmatchedParen {
                        position: paren_pos,
                    }),
                }
            }
            Some(other) => Err(CalcFieldParseError::UnexpectedToken {
                token: format!("{other:?}"),
                position: self.pos,
            }),
            None => Err(CalcFieldParseError::EmptyExpression),
        };
        self.leave();
        result
    }
}

pub(super) fn parse_tokens(tokens: Vec<Token>) -> Result<CalcFieldExpr, CalcFieldParseError> {
    let mut parser = Parser::new(tokens);
    let expr = parser.parse_expr()?;

    // Ensure all tokens were consumed
    if parser.pos < parser.tokens.len() {
        return Err(CalcFieldParseError::UnexpectedToken {
            token: format!("{:?}", parser.tokens[parser.pos]),
            position: parser.pos + 1,
        });
    }

    Ok(expr)
}
