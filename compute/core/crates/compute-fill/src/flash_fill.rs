//! Flash Fill — infer text transformation programs from input→output examples.
//!
//! Inspired by Gulwani 2011 ("Automating String Processing in Spreadsheets Using
//! Input-Output Examples"). Given a column of source values and a partial column
//! of example outputs, synthesizes a transformation program and applies it to
//! the remaining (unfilled) rows.

use serde::{Deserialize, Serialize};
use value_types::CellValue;

// ─── Public types ───────────────────────────────────────────────────────────

/// Input to the flash fill algorithm.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlashFillInput {
    /// Source values (the "input" column).
    pub source_values: Vec<CellValue>,
    /// Example values — `CellValue::Null` means "to be filled by the algorithm".
    pub example_values: Vec<CellValue>,
}

/// Result of a flash fill operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlashFillResult {
    /// The filled output column (same length as input). Rows that already had
    /// an example retain that value; rows that were Null are filled.
    pub filled_values: Vec<CellValue>,
    /// Whether a consistent transformation program was found.
    pub success: bool,
    /// Human-readable description of the inferred pattern.
    pub pattern_description: Option<String>,
}

// ─── Token types ────────────────────────────────────────────────────────────

/// A token produced by the tokenizer — classifies contiguous runs of characters.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Token {
    /// Contiguous alphabetic characters.
    Alpha(String),
    /// Contiguous digit characters.
    Digit(String),
    /// A single delimiter character (punctuation, symbol).
    Delimiter(char),
    /// Contiguous whitespace.
    Whitespace(String),
}

impl Token {
    fn text(&self) -> String {
        match self {
            Token::Alpha(s) | Token::Digit(s) | Token::Whitespace(s) => s.clone(),
            Token::Delimiter(c) => c.to_string(),
        }
    }

    /// Returns true if this token has the same *kind* (Alpha/Digit/Delimiter/Whitespace).
    fn same_kind(&self, other: &Token) -> bool {
        matches!(
            (self, other),
            (Token::Alpha(_), Token::Alpha(_))
                | (Token::Digit(_), Token::Digit(_))
                | (Token::Delimiter(_), Token::Delimiter(_))
                | (Token::Whitespace(_), Token::Whitespace(_))
        )
    }
}

/// Tokenize a string into a sequence of typed tokens.
fn tokenize(s: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut chars = s.chars().peekable();

    while let Some(&c) = chars.peek() {
        if c.is_alphabetic() {
            let mut buf = String::new();
            while let Some(&ch) = chars.peek() {
                if ch.is_alphabetic() {
                    buf.push(ch);
                    chars.next();
                } else {
                    break;
                }
            }
            tokens.push(Token::Alpha(buf));
        } else if c.is_ascii_digit() {
            let mut buf = String::new();
            while let Some(&ch) = chars.peek() {
                if ch.is_ascii_digit() {
                    buf.push(ch);
                    chars.next();
                } else {
                    break;
                }
            }
            tokens.push(Token::Digit(buf));
        } else if c.is_whitespace() {
            let mut buf = String::new();
            while let Some(&ch) = chars.peek() {
                if ch.is_whitespace() {
                    buf.push(ch);
                    chars.next();
                } else {
                    break;
                }
            }
            tokens.push(Token::Whitespace(buf));
        } else {
            // Delimiter — single character
            tokens.push(Token::Delimiter(c));
            chars.next();
        }
    }

    tokens
}

// ─── Transformation program ────────────────────────────────────────────────

/// A single operation in a transformation program.
#[derive(Debug, Clone, PartialEq, Eq)]
enum TransformOp {
    /// Copy a full token from the source by token index.
    CopyToken { source_index: usize },
    /// Copy a substring of a token from the source.
    CopySubstring {
        source_index: usize,
        start: usize,
        end: usize,
    },
    /// Insert a literal string.
    InsertLiteral(String),
    /// Copy a source token and convert to uppercase.
    UpperCase { source_index: usize },
    /// Copy a source token and convert to lowercase.
    LowerCase { source_index: usize },
    /// Copy a source token and convert to title case.
    TitleCase { source_index: usize },
}

/// A synthesized transformation program — a sequence of operations that, when
/// applied to a tokenized source string, produces the output.
#[derive(Debug, Clone)]
struct TransformProgram {
    ops: Vec<TransformOp>,
}

impl TransformProgram {
    /// Apply this program to a tokenized source, producing the output string.
    fn apply(&self, source_tokens: &[Token]) -> Option<String> {
        let mut result = String::new();
        for op in &self.ops {
            match op {
                TransformOp::CopyToken { source_index } => {
                    let tok = source_tokens.get(*source_index)?;
                    result.push_str(&tok.text());
                }
                TransformOp::CopySubstring {
                    source_index,
                    start,
                    end,
                } => {
                    let tok = source_tokens.get(*source_index)?;
                    let text = tok.text();
                    let chars: Vec<char> = text.chars().collect();
                    if *end > chars.len() || *start >= *end {
                        return None;
                    }
                    let substr: String = chars[*start..*end].iter().collect();
                    result.push_str(&substr);
                }
                TransformOp::InsertLiteral(lit) => {
                    result.push_str(lit);
                }
                TransformOp::UpperCase { source_index } => {
                    let tok = source_tokens.get(*source_index)?;
                    result.push_str(&tok.text().to_uppercase());
                }
                TransformOp::LowerCase { source_index } => {
                    let tok = source_tokens.get(*source_index)?;
                    result.push_str(&tok.text().to_lowercase());
                }
                TransformOp::TitleCase { source_index } => {
                    let tok = source_tokens.get(*source_index)?;
                    let text = tok.text();
                    let title: String = text
                        .chars()
                        .enumerate()
                        .map(|(i, c)| {
                            if i == 0 {
                                c.to_uppercase().next().unwrap_or(c)
                            } else {
                                c.to_lowercase().next().unwrap_or(c)
                            }
                        })
                        .collect();
                    result.push_str(&title);
                }
            }
        }
        Some(result)
    }

    /// Generate a human-readable description.
    fn describe(&self) -> String {
        let parts: Vec<String> = self
            .ops
            .iter()
            .map(|op| match op {
                TransformOp::CopyToken { source_index } => {
                    format!("copy token #{}", source_index + 1)
                }
                TransformOp::CopySubstring {
                    source_index,
                    start,
                    end,
                } => format!(
                    "substring of token #{} [{}..{}]",
                    source_index + 1,
                    start,
                    end
                ),
                TransformOp::InsertLiteral(s) => format!("insert {:?}", s),
                TransformOp::UpperCase { source_index } => {
                    format!("uppercase token #{}", source_index + 1)
                }
                TransformOp::LowerCase { source_index } => {
                    format!("lowercase token #{}", source_index + 1)
                }
                TransformOp::TitleCase { source_index } => {
                    format!("titlecase token #{}", source_index + 1)
                }
            })
            .collect();
        parts.join(" + ")
    }
}

// ─── Program synthesis ─────────────────────────────────────────────────────

/// Try to find a source token that matches the output token (possibly with a
/// case transformation).
fn match_token(source_tokens: &[Token], output_token: &Token) -> Option<TransformOp> {
    let out_text = output_token.text();

    for (i, src_tok) in source_tokens.iter().enumerate() {
        let src_text = src_tok.text();

        // Exact match
        if src_text == out_text && src_tok.same_kind(output_token) {
            return Some(TransformOp::CopyToken { source_index: i });
        }

        // Case transformations (only for Alpha tokens)
        if matches!(src_tok, Token::Alpha(_)) && matches!(output_token, Token::Alpha(_)) {
            if src_text.to_uppercase() == out_text {
                return Some(TransformOp::UpperCase { source_index: i });
            }
            if src_text.to_lowercase() == out_text {
                return Some(TransformOp::LowerCase { source_index: i });
            }
            // Title case
            let title: String = src_text
                .chars()
                .enumerate()
                .map(|(j, c)| {
                    if j == 0 {
                        c.to_uppercase().next().unwrap_or(c)
                    } else {
                        c.to_lowercase().next().unwrap_or(c)
                    }
                })
                .collect();
            if title == out_text {
                return Some(TransformOp::TitleCase { source_index: i });
            }
        }
    }

    None
}

/// Try to find a source token that *contains* the output token text as a
/// substring. Returns a CopySubstring op if found.
fn match_substring(source_tokens: &[Token], output_text: &str) -> Option<TransformOp> {
    for (i, src_tok) in source_tokens.iter().enumerate() {
        let src_text = src_tok.text();
        let src_chars: Vec<char> = src_text.chars().collect();
        let out_chars: Vec<char> = output_text.chars().collect();

        if out_chars.is_empty() || out_chars.len() > src_chars.len() {
            continue;
        }

        // Try to find the substring
        for start in 0..=(src_chars.len() - out_chars.len()) {
            if src_chars[start..start + out_chars.len()] == out_chars[..] {
                return Some(TransformOp::CopySubstring {
                    source_index: i,
                    start,
                    end: start + out_chars.len(),
                });
            }
        }

        // Also try case-insensitive substring for Alpha tokens
        if matches!(src_tok, Token::Alpha(_)) {
            let src_lower: Vec<char> = src_text.to_lowercase().chars().collect();
            let out_lower: Vec<char> = output_text.to_lowercase().chars().collect();
            if out_lower.len() <= src_lower.len() {
                for start in 0..=(src_lower.len() - out_lower.len()) {
                    if src_lower[start..start + out_lower.len()] == out_lower[..] {
                        // Check which case transformation applies
                        let actual_sub: String =
                            src_chars[start..start + out_chars.len()].iter().collect();
                        if actual_sub != output_text {
                            // We found it case-insensitively but need a case transform.
                            // For simplicity, use CopySubstring with the right indices
                            // and let the caller handle case. For now, skip this.
                            continue;
                        }
                        return Some(TransformOp::CopySubstring {
                            source_index: i,
                            start,
                            end: start + out_chars.len(),
                        });
                    }
                }
            }
        }
    }
    None
}

/// Synthesize a program from a single (source, output) example pair.
///
/// Strategy: tokenize both, then greedily match each output token to a source
/// token (copy, case-transform, or substring). Unmatched output tokens become
/// InsertLiteral ops.
fn synthesize_from_pair(source: &str, output: &str) -> TransformProgram {
    let src_tokens = tokenize(source);
    let out_tokens = tokenize(output);

    let mut ops = Vec::new();

    for out_tok in &out_tokens {
        // 1. Try full-token match (exact or case-transformed)
        if let Some(op) = match_token(&src_tokens, out_tok) {
            ops.push(op);
            continue;
        }

        // 2. Try substring match
        let out_text = out_tok.text();
        if let Some(op) = match_substring(&src_tokens, &out_text) {
            ops.push(op);
            continue;
        }

        // 3. Literal — not found in source
        ops.push(TransformOp::InsertLiteral(out_text));
    }

    TransformProgram { ops }
}

/// Validate a candidate program against all provided example pairs.
/// Returns true if the program produces the correct output for every example.
fn validate_program(program: &TransformProgram, examples: &[(String, String)]) -> bool {
    for (src, expected_output) in examples {
        let src_tokens = tokenize(src);
        match program.apply(&src_tokens) {
            Some(result) if result == *expected_output => {}
            _ => return false,
        }
    }
    true
}

/// Try to synthesize a program that is consistent with ALL examples.
///
/// Strategy (Occam's razor — simplest consistent program):
/// 1. For each example pair, synthesize a candidate program.
/// 2. Validate each candidate against ALL examples.
/// 3. Return the first (simplest) program that validates.
/// 4. If none validate, try progressively more complex strategies.
fn synthesize_program(examples: &[(String, String)]) -> Option<TransformProgram> {
    if examples.is_empty() {
        return None;
    }

    // Strategy 1: single-example synthesis, validated against all.
    for (src, out) in examples {
        let candidate = synthesize_from_pair(src, out);
        if validate_program(&candidate, examples) {
            return Some(candidate);
        }
    }

    // Strategy 2: Try combining token-level ops from different examples.
    // Tokenize all outputs; if they have the same number of tokens, try
    // to build a position-by-position program.
    let token_counts: Vec<usize> = examples.iter().map(|(_, o)| tokenize(o).len()).collect();
    if !token_counts.is_empty() && token_counts.iter().all(|&c| c == token_counts[0]) {
        let num_tokens = token_counts[0];
        if let Some(prog) = synthesize_positional(examples, num_tokens)
            && validate_program(&prog, examples)
        {
            return Some(prog);
        }
    }

    None
}

/// Positional synthesis: for each output token position, find the operation
/// that is consistent across all examples.
fn synthesize_positional(
    examples: &[(String, String)],
    num_out_tokens: usize,
) -> Option<TransformProgram> {
    let mut ops = Vec::with_capacity(num_out_tokens);

    let tokenized: Vec<(Vec<Token>, Vec<Token>)> = examples
        .iter()
        .map(|(s, o)| (tokenize(s), tokenize(o)))
        .collect();

    for pos in 0..num_out_tokens {
        // Collect candidate ops for this position from each example
        let mut candidate_op: Option<TransformOp> = None;
        let mut consistent = true;

        for (src_toks, out_toks) in &tokenized {
            let out_tok = &out_toks[pos];

            // Try full-token match
            let op = match_token(src_toks, out_tok)
                .or_else(|| match_substring(src_toks, &out_tok.text()));

            let op = match op {
                Some(o) => o,
                None => {
                    // Must be a literal — check it's the same across all examples
                    TransformOp::InsertLiteral(out_tok.text())
                }
            };

            match &candidate_op {
                None => candidate_op = Some(op),
                Some(existing) => {
                    if *existing != op {
                        // Check if both are InsertLiteral with the same text
                        consistent = false;
                        break;
                    }
                }
            }
        }

        if !consistent {
            return None;
        }
        ops.push(candidate_op?);
    }

    Some(TransformProgram { ops })
}

// ─── Public API ─────────────────────────────────────────────────────────────

/// Extract string representation from a CellValue for flash fill purposes.
fn cell_value_to_string(v: &CellValue) -> Option<String> {
    match v {
        CellValue::Text(s) => Some(s.to_string()),
        CellValue::Number(n) => Some(n.to_string()),
        CellValue::Boolean(b) => Some(if *b { "TRUE" } else { "FALSE" }.to_string()),
        _ => None,
    }
}

/// Run the flash fill algorithm.
///
/// Collects example pairs from rows where both source and example are non-null,
/// synthesizes a transformation program, validates it, and fills the remaining
/// rows.
pub fn flash_fill(input: &FlashFillInput) -> FlashFillResult {
    let n = input.source_values.len();
    if n == 0 || input.example_values.len() != n {
        return FlashFillResult {
            filled_values: input.example_values.clone(),
            success: false,
            pattern_description: None,
        };
    }

    // Step 1: Collect example pairs
    let mut examples: Vec<(String, String)> = Vec::new();
    let mut to_fill: Vec<usize> = Vec::new();

    for i in 0..n {
        let src = cell_value_to_string(&input.source_values[i]);
        let ex = cell_value_to_string(&input.example_values[i]);

        match (src, ex) {
            (Some(s), Some(e)) => examples.push((s, e)),
            (Some(_), None) => {
                // source exists, example is null → fill this row
                if matches!(input.example_values[i], CellValue::Null) {
                    to_fill.push(i);
                }
            }
            _ => {}
        }
    }

    // Need at least one example
    if examples.is_empty() {
        return FlashFillResult {
            filled_values: input.example_values.clone(),
            success: false,
            pattern_description: None,
        };
    }

    // Step 2–4: Synthesize and validate program
    let program = match synthesize_program(&examples) {
        Some(p) => p,
        None => {
            return FlashFillResult {
                filled_values: input.example_values.clone(),
                success: false,
                pattern_description: None,
            };
        }
    };

    // Step 5: Apply to remaining rows
    let mut filled = input.example_values.clone();

    for &i in &to_fill {
        if let Some(src_str) = cell_value_to_string(&input.source_values[i]) {
            let src_tokens = tokenize(&src_str);
            if let Some(result) = program.apply(&src_tokens) {
                filled[i] = CellValue::Text(result.into());
            }
            // If apply returns None (e.g. token count mismatch), leave as Null
        }
    }

    let desc = program.describe();

    FlashFillResult {
        filled_values: filled,
        success: true,
        pattern_description: Some(desc),
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    #[test]
    fn test_tokenize_basic() {
        let tokens = tokenize("John Smith");
        assert_eq!(tokens.len(), 3);
        assert_eq!(tokens[0], Token::Alpha("John".into()));
        assert_eq!(tokens[1], Token::Whitespace(" ".into()));
        assert_eq!(tokens[2], Token::Alpha("Smith".into()));
    }

    #[test]
    fn test_tokenize_digits_and_delimiters() {
        let tokens = tokenize("2026-04-13");
        assert_eq!(tokens.len(), 5);
        assert_eq!(tokens[0], Token::Digit("2026".into()));
        assert_eq!(tokens[1], Token::Delimiter('-'));
        assert_eq!(tokens[2], Token::Digit("04".into()));
        assert_eq!(tokens[3], Token::Delimiter('-'));
        assert_eq!(tokens[4], Token::Digit("13".into()));
    }

    #[test]
    fn test_tokenize_phone() {
        let tokens = tokenize("(555) 123-4567");
        assert_eq!(tokens.len(), 7);
        assert_eq!(tokens[0], Token::Delimiter('('));
        assert_eq!(tokens[1], Token::Digit("555".into()));
        assert_eq!(tokens[2], Token::Delimiter(')'));
        assert_eq!(tokens[3], Token::Whitespace(" ".into()));
        assert_eq!(tokens[4], Token::Digit("123".into()));
        assert_eq!(tokens[5], Token::Delimiter('-'));
        assert_eq!(tokens[6], Token::Digit("4567".into()));
    }

    // ── Flash fill tests ────────────────────────────────────────────────

    #[test]
    fn test_name_extraction() {
        // Extract first name from "First Last"
        let input = FlashFillInput {
            source_values: vec![text("John Smith"), text("Jane Doe"), text("Bob Wilson")],
            example_values: vec![
                text("John"),    // example
                CellValue::Null, // fill
                CellValue::Null, // fill
            ],
        };

        let result = flash_fill(&input);
        assert!(result.success);
        assert_eq!(result.filled_values[0], text("John"));
        assert_eq!(result.filled_values[1], text("Jane"));
        assert_eq!(result.filled_values[2], text("Bob"));
    }

    #[test]
    fn test_phone_formatting() {
        let input = FlashFillInput {
            source_values: vec![text("5551234567"), text("5559876543"), text("1234567890")],
            example_values: vec![text("(555) 123-4567"), CellValue::Null, CellValue::Null],
        };

        let result = flash_fill(&input);
        assert!(result.success);
        assert_eq!(result.filled_values[0], text("(555) 123-4567"));
        assert_eq!(result.filled_values[1], text("(555) 987-6543"));
        assert_eq!(result.filled_values[2], text("(123) 456-7890"));
    }

    #[test]
    fn test_date_reformatting() {
        let input = FlashFillInput {
            source_values: vec![text("2026-04-13"), text("2025-12-25"), text("2024-01-01")],
            example_values: vec![text("04/13/2026"), CellValue::Null, CellValue::Null],
        };

        let result = flash_fill(&input);
        assert!(result.success);
        assert_eq!(result.filled_values[0], text("04/13/2026"));
        assert_eq!(result.filled_values[1], text("12/25/2025"));
        assert_eq!(result.filled_values[2], text("01/01/2024"));
    }

    #[test]
    fn test_case_transform() {
        let input = FlashFillInput {
            source_values: vec![text("hello"), text("world"), text("rust")],
            example_values: vec![text("HELLO"), CellValue::Null, CellValue::Null],
        };

        let result = flash_fill(&input);
        assert!(result.success);
        assert_eq!(result.filled_values[1], text("WORLD"));
        assert_eq!(result.filled_values[2], text("RUST"));
    }

    #[test]
    fn test_constant_injection() {
        // "John" → "Dear John,"
        let input = FlashFillInput {
            source_values: vec![text("John"), text("Jane"), text("Bob")],
            example_values: vec![text("Dear John,"), CellValue::Null, CellValue::Null],
        };

        let result = flash_fill(&input);
        assert!(result.success);
        assert_eq!(result.filled_values[1], text("Dear Jane,"));
        assert_eq!(result.filled_values[2], text("Dear Bob,"));
    }

    #[test]
    fn test_no_pattern_found() {
        // Inconsistent examples — no single program explains both
        let input = FlashFillInput {
            source_values: vec![text("abc"), text("def"), text("ghi")],
            example_values: vec![
                text("xyz"), // completely unrelated
                text("123"), // completely unrelated and different transformation
                CellValue::Null,
            ],
        };

        let result = flash_fill(&input);
        assert!(!result.success);
    }

    #[test]
    fn test_multiple_examples_disambiguate() {
        // With one example "John Smith" → "John", it could be "copy first word".
        // Adding a second example confirms the pattern.
        let input = FlashFillInput {
            source_values: vec![
                text("John Smith"),
                text("Jane Doe"),
                text("Bob Wilson"),
                text("Alice Johnson"),
            ],
            example_values: vec![text("John"), text("Jane"), CellValue::Null, CellValue::Null],
        };

        let result = flash_fill(&input);
        assert!(result.success);
        assert_eq!(result.filled_values[2], text("Bob"));
        assert_eq!(result.filled_values[3], text("Alice"));
    }

    #[test]
    fn test_last_name_extraction() {
        // Extract last name
        let input = FlashFillInput {
            source_values: vec![text("John Smith"), text("Jane Doe"), text("Bob Wilson")],
            example_values: vec![text("Smith"), CellValue::Null, CellValue::Null],
        };

        let result = flash_fill(&input);
        assert!(result.success);
        assert_eq!(result.filled_values[1], text("Doe"));
        assert_eq!(result.filled_values[2], text("Wilson"));
    }

    #[test]
    fn test_empty_input() {
        let input = FlashFillInput {
            source_values: vec![],
            example_values: vec![],
        };

        let result = flash_fill(&input);
        assert!(!result.success);
    }

    #[test]
    fn test_no_examples_provided() {
        let input = FlashFillInput {
            source_values: vec![text("hello"), text("world")],
            example_values: vec![CellValue::Null, CellValue::Null],
        };

        let result = flash_fill(&input);
        assert!(!result.success);
    }

    #[test]
    fn test_title_case_transform() {
        let input = FlashFillInput {
            source_values: vec![text("HELLO"), text("WORLD"), text("RUST")],
            example_values: vec![text("Hello"), CellValue::Null, CellValue::Null],
        };

        let result = flash_fill(&input);
        assert!(result.success);
        assert_eq!(result.filled_values[1], text("World"));
        assert_eq!(result.filled_values[2], text("Rust"));
    }

    #[test]
    fn test_pattern_description_present() {
        let input = FlashFillInput {
            source_values: vec![text("hello"), text("world")],
            example_values: vec![text("HELLO"), CellValue::Null],
        };

        let result = flash_fill(&input);
        assert!(result.success);
        assert!(result.pattern_description.is_some());
    }
}
