use super::CalcFieldParseError;

/// Token types produced by the lexer.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum Token {
    Number(f64),
    Ident(String),
    Plus,
    Minus,
    Star,
    Slash,
    LParen,
    RParen,
}

/// Tokenize a formula string into a sequence of tokens.
///
/// Returns an error with a descriptive message on invalid input.
pub(super) fn tokenize(input: &str) -> Result<Vec<Token>, CalcFieldParseError> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let ch = chars[i];

        // Skip whitespace
        if ch.is_ascii_whitespace() {
            i += 1;
            continue;
        }

        match ch {
            '+' => {
                tokens.push(Token::Plus);
                i += 1;
            }
            '-' => {
                tokens.push(Token::Minus);
                i += 1;
            }
            '*' => {
                tokens.push(Token::Star);
                i += 1;
            }
            '/' => {
                tokens.push(Token::Slash);
                i += 1;
            }
            '(' => {
                tokens.push(Token::LParen);
                i += 1;
            }
            ')' => {
                tokens.push(Token::RParen);
                i += 1;
            }

            // Numeric literal: digits, optional dot, more digits
            '0'..='9' | '.'
                if {
                    // Only treat '.' as start of number if followed by a digit
                    ch != '.' || (i + 1 < len && chars[i + 1].is_ascii_digit())
                } =>
            {
                let start = i;
                let mut has_dot = ch == '.';
                i += 1;
                while i < len {
                    if chars[i].is_ascii_digit() {
                        i += 1;
                    } else if chars[i] == '.' && !has_dot {
                        has_dot = true;
                        i += 1;
                    } else {
                        break;
                    }
                }
                let num_str: String = chars[start..i].iter().collect();
                let value =
                    num_str
                        .parse::<f64>()
                        .map_err(|_| CalcFieldParseError::UnexpectedToken {
                            token: num_str.clone(),
                            position: start + 1,
                        })?;
                tokens.push(Token::Number(value));
            }

            // Quoted field reference with single quotes ('' is an escaped quote)
            '\'' => {
                let start = i;
                i += 1; // skip opening quote
                let mut name = String::new();
                while i < len {
                    if chars[i] == '\'' {
                        // Check for escaped quote ''
                        if i + 1 < len && chars[i + 1] == '\'' {
                            name.push('\'');
                            i += 2;
                            continue;
                        }
                        break; // End of quoted name
                    }
                    name.push(chars[i]);
                    i += 1;
                }
                if i >= len {
                    return Err(CalcFieldParseError::UnmatchedParen {
                        position: start + 1,
                    });
                }
                i += 1; // skip closing quote
                if name.is_empty() {
                    return Err(CalcFieldParseError::UnexpectedToken {
                        token: "''".to_string(),
                        position: start + 1,
                    });
                }
                tokens.push(Token::Ident(name));
            }

            // Quoted field reference with double quotes ("" is an escaped quote)
            '"' => {
                let start = i;
                i += 1; // skip opening quote
                let mut name = String::new();
                while i < len {
                    if chars[i] == '"' {
                        // Check for escaped quote ""
                        if i + 1 < len && chars[i + 1] == '"' {
                            name.push('"');
                            i += 2;
                            continue;
                        }
                        break; // End of quoted name
                    }
                    name.push(chars[i]);
                    i += 1;
                }
                if i >= len {
                    return Err(CalcFieldParseError::UnmatchedParen {
                        position: start + 1,
                    });
                }
                i += 1; // skip closing quote
                if name.is_empty() {
                    return Err(CalcFieldParseError::UnexpectedToken {
                        token: "\"\"".to_string(),
                        position: start + 1,
                    });
                }
                tokens.push(Token::Ident(name));
            }

            // Bare identifier (field reference)
            _ if ch.is_alphabetic() || ch == '_' => {
                let start = i;
                i += 1;
                while i < len && (chars[i].is_alphanumeric() || chars[i] == '_') {
                    i += 1;
                }
                let name: String = chars[start..i].iter().collect();
                tokens.push(Token::Ident(name));
            }

            _ => {
                return Err(CalcFieldParseError::UnexpectedToken {
                    token: ch.to_string(),
                    position: i + 1,
                });
            }
        }
    }

    Ok(tokens)
}
