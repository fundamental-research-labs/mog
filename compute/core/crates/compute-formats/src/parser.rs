//! Format code parser: tokenizer, section splitter, and m-ambiguity resolution.

use crate::types::{FormatCode, FormatSection, Token, is_datetime_token, is_digit_placeholder};

pub(crate) fn parse_format_code(code: &str) -> FormatCode {
    let raw_sections = split_sections(code);
    let sections: Vec<FormatSection> = raw_sections.iter().map(|s| parse_section(s)).collect();
    FormatCode { sections }
}

/// Split format code by semicolons, respecting quoted strings.
pub(crate) fn split_sections(code: &str) -> Vec<String> {
    let mut sections = Vec::new();
    let mut current = String::new();
    // Vec<char> is intentional: format codes may contain non-ASCII currency symbols
    // inside quoted strings, so byte-based indexing would corrupt multi-byte chars.
    let chars: Vec<char> = code.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        match chars[i] {
            ';' => {
                sections.push(std::mem::take(&mut current));
            }
            '"' => {
                current.push('"');
                i += 1;
                while i < chars.len() && chars[i] != '"' {
                    current.push(chars[i]);
                    i += 1;
                }
                if i < chars.len() {
                    current.push('"');
                }
            }
            '\\' => {
                current.push('\\');
                i += 1;
                if i < chars.len() {
                    current.push(chars[i]);
                }
            }
            _ => {
                current.push(chars[i]);
            }
        }
        i += 1;
    }
    sections.push(current);
    sections
}

fn parse_section(section: &str) -> FormatSection {
    let raw_tokens = tokenize(section);
    let tokens = resolve_m_ambiguity(raw_tokens);
    analyze_section(tokens)
}

/// First-pass tokenizer. Commas are all `Token::ThousandsSep` initially;
/// `analyze_section` reclassifies trailing ones as `ScaleDivisor`.
#[allow(clippy::too_many_lines)] // token dispatch table is inherently long
fn tokenize(section: &str) -> Vec<Token> {
    // Vec<char> is intentional: this function uses multi-char lookahead, case-insensitive
    // matching, and char slicing (e.g., chars[i..i+5]) that make byte-based parsing fragile.
    let chars: Vec<char> = section.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;

    while i < chars.len() {
        match chars[i] {
            '0' => {
                tokens.push(Token::Zero);
                i += 1;
            }
            '#' => {
                tokens.push(Token::Hash);
                i += 1;
            }
            '?' => {
                tokens.push(Token::Question);
                i += 1;
            }
            '.' => {
                tokens.push(Token::DecimalPoint);
                i += 1;
            }
            ',' => {
                tokens.push(Token::ThousandsSep);
                i += 1;
            } // reclassified later
            '%' => {
                tokens.push(Token::Percent);
                i += 1;
            }
            '@' => {
                tokens.push(Token::TextPlaceholder);
                i += 1;
            }
            '/' => {
                // Check if this is a fraction slash: preceded by digit placeholder(s) and
                // followed by digit placeholder(s) (0, #, ?) or a fixed denominator.
                let preceded = tokens.iter().rev().any(is_digit_placeholder);
                let followed_by_placeholder =
                    i + 1 < chars.len() && matches!(chars[i + 1], '0' | '#' | '?');
                let followed_by_fixed_denominator =
                    i + 1 < chars.len() && chars[i + 1].is_ascii_digit() && chars[i + 1] != '0';

                if preceded && followed_by_fixed_denominator {
                    let mut denominator = String::new();
                    let mut j = i + 1;
                    while j < chars.len() && chars[j].is_ascii_digit() {
                        denominator.push(chars[j]);
                        j += 1;
                    }
                    let valid_denominator =
                        matches!(denominator.parse::<u64>(), Ok(value) if value > 0);
                    if valid_denominator {
                        tokens.push(Token::FractionSlash);
                        tokens.push(Token::FractionDenominatorLiteral(denominator));
                        i = j;
                    } else {
                        tokens.push(Token::Literal("/".to_string()));
                        i += 1;
                    }
                } else if preceded && followed_by_placeholder {
                    tokens.push(Token::FractionSlash);
                    i += 1;
                } else {
                    tokens.push(Token::Literal("/".to_string()));
                    i += 1;
                }
            }
            'E' | 'e' => {
                if i + 1 < chars.len() && (chars[i + 1] == '+' || chars[i + 1] == '-') {
                    tokens.push(Token::Exponent {
                        plus_sign: chars[i + 1] == '+',
                    });
                    i += 2;
                } else {
                    tokens.push(Token::Literal(chars[i].to_string()));
                    i += 1;
                }
            }
            '"' => {
                i += 1;
                let mut lit = String::new();
                while i < chars.len() && chars[i] != '"' {
                    lit.push(chars[i]);
                    i += 1;
                }
                if i < chars.len() {
                    i += 1;
                }
                if !lit.is_empty() {
                    tokens.push(Token::Literal(lit));
                }
            }
            '\\' => {
                i += 1;
                if i < chars.len() {
                    tokens.push(Token::Literal(chars[i].to_string()));
                    i += 1;
                }
            }
            '_' => {
                i += 1;
                if i < chars.len() {
                    tokens.push(Token::SkipWidth(chars[i]));
                    i += 1;
                }
            }
            '*' => {
                i += 1;
                if i < chars.len() {
                    tokens.push(Token::RepeatFill(chars[i]));
                    i += 1;
                }
            }
            '[' => {
                i += 1;
                let mut content = String::new();
                while i < chars.len() && chars[i] != ']' {
                    content.push(chars[i]);
                    i += 1;
                }
                if i < chars.len() {
                    i += 1;
                }
                let upper = content.to_uppercase();
                if upper.starts_with('$') {
                    let inner = &content[1..];
                    let symbol = if let Some(dash) = inner.find('-') {
                        &inner[..dash]
                    } else {
                        inner
                    };
                    if !symbol.is_empty() {
                        tokens.push(Token::Literal(symbol.to_string()));
                    }
                } else if is_color_name(&upper) || upper.starts_with("COLOR") {
                    tokens.push(Token::Color(content));
                } else if upper.starts_with('>') || upper.starts_with('<') || upper.starts_with('=')
                {
                    tokens.push(Token::Condition(content));
                } else if upper == "H" || upper == "HH" {
                    tokens.push(Token::ElapsedHours);
                } else if upper == "M" || upper == "MM" {
                    tokens.push(Token::ElapsedMinutes);
                } else if upper == "S" || upper == "SS" {
                    tokens.push(Token::ElapsedSeconds);
                } else {
                    tokens.push(Token::Literal(format!("[{content}]")));
                }
            }
            'A' | 'a' => {
                if i + 4 < chars.len() {
                    let five: String = chars[i..i + 5].iter().collect();
                    if five.to_uppercase() == "AM/PM" {
                        tokens.push(Token::AmPm(five));
                        i += 5;
                        continue;
                    }
                }
                if i + 2 < chars.len() {
                    let three: String = chars[i..i + 3].iter().collect();
                    if three.to_uppercase() == "A/P" {
                        tokens.push(Token::AmPm(three));
                        i += 3;
                        continue;
                    }
                }
                tokens.push(Token::Literal(chars[i].to_string()));
                i += 1;
            }
            'y' | 'Y' => {
                let c = count_ci(&chars, i, 'y');
                tokens.push(if c >= 4 {
                    Token::DateYear4
                } else {
                    Token::DateYear2
                });
                i += c;
            }
            'd' | 'D' => {
                let c = count_ci(&chars, i, 'd');
                tokens.push(match c {
                    1 => Token::DateDay1,
                    2 => Token::DateDay2,
                    3 => Token::DateDayName3,
                    _ => Token::DateDayName4,
                });
                i += c;
            }
            'h' | 'H' => {
                let c = count_ci(&chars, i, 'h');
                tokens.push(if c >= 2 {
                    Token::DateHour2
                } else {
                    Token::DateHour1
                });
                i += c;
            }
            's' | 'S' => {
                let c = count_ci(&chars, i, 's');
                tokens.push(if c >= 2 {
                    Token::DateSecond2
                } else {
                    Token::DateSecond1
                });
                i += c;
            }
            'm' | 'M' => {
                let c = count_ci(&chars, i, 'm');
                tokens.push(match c {
                    1 => Token::DateMonth1,
                    2 => Token::DateMonth2,
                    3 => Token::DateMonthName3,
                    4 => Token::DateMonthName4,
                    _ => Token::DateMonthName5,
                });
                i += c;
            }
            'G' | 'g' => {
                if i + 6 < chars.len() {
                    let w: String = chars[i..i + 7].iter().collect();
                    if w.eq_ignore_ascii_case("General") {
                        tokens.push(Token::Literal("General".to_string()));
                        i += 7;
                        continue;
                    }
                }
                tokens.push(Token::Literal(chars[i].to_string()));
                i += 1;
            }
            // Literal characters: punctuation, operators, spaces, and everything else
            _ => {
                tokens.push(Token::Literal(chars[i].to_string()));
                i += 1;
            }
        }
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_sections_on_unquoted_semicolons() {
        let sections = split_sections("pos;neg;zero;text");
        assert_eq!(sections.len(), 4);
        assert_eq!(sections[0], "pos");
        assert_eq!(sections[1], "neg");
        assert_eq!(sections[2], "zero");
        assert_eq!(sections[3], "text");
    }

    #[test]
    fn keeps_quoted_semicolons_inside_section() {
        let sections = split_sections("0\";\"0");
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0], "0\";\"0");
    }

    #[test]
    fn marks_single_at_section_as_text_section() {
        let code = parse_format_code("@");
        assert_eq!(code.sections.len(), 1);
        assert!(code.sections[0].is_text_section);
    }

    #[test]
    fn parses_fixed_fraction_denominator_digits() {
        let section = parse_section("# ??/100");
        assert!(
            section
                .tokens
                .iter()
                .any(|token| matches!(token, Token::FractionSlash))
        );
        assert!(section.tokens.iter().any(
            |token| matches!(token, Token::FractionDenominatorLiteral(value) if value == "100")
        ));
    }

    #[test]
    fn leaves_single_zero_denominator_as_placeholder_fraction() {
        let section = parse_section("0/0");
        assert!(
            section
                .tokens
                .iter()
                .any(|token| matches!(token, Token::FractionSlash))
        );
        assert!(
            !section
                .tokens
                .iter()
                .any(|token| matches!(token, Token::FractionDenominatorLiteral(_)))
        );
    }
}

fn count_ci(chars: &[char], start: usize, target: char) -> usize {
    let lo = target.to_ascii_lowercase();
    chars[start..]
        .iter()
        .take_while(|c| c.to_ascii_lowercase() == lo)
        .count()
}

fn is_color_name(upper: &str) -> bool {
    matches!(
        upper,
        "BLACK" | "BLUE" | "CYAN" | "GREEN" | "MAGENTA" | "RED" | "WHITE" | "YELLOW"
    )
}

/// Resolve m/mm ambiguity: month vs minute.
fn resolve_m_ambiguity(mut tokens: Vec<Token>) -> Vec<Token> {
    let len = tokens.len();
    for i in 0..len {
        let is_m1 = matches!(tokens[i], Token::DateMonth1);
        let is_m2 = matches!(tokens[i], Token::DateMonth2);
        if !is_m1 && !is_m2 {
            continue;
        }

        let preceded_by_hour = look_back_for_hour(&tokens, i);
        let followed_by_second = look_fwd_for_second(&tokens, i);

        if preceded_by_hour || followed_by_second {
            tokens[i] = if is_m1 {
                Token::DateMinute1
            } else {
                Token::DateMinute2
            };
        }
    }
    tokens
}

fn look_back_for_hour(tokens: &[Token], pos: usize) -> bool {
    for i in (0..pos).rev() {
        match &tokens[i] {
            Token::DateHour1 | Token::DateHour2 | Token::ElapsedHours => return true,
            Token::Literal(_) | Token::SkipWidth(_) | Token::Color(_) | Token::Condition(_) => {}
            t if is_datetime_token(t) => return false,
            _ => return false,
        }
    }
    false
}

fn look_fwd_for_second(tokens: &[Token], pos: usize) -> bool {
    for token in tokens.iter().skip(pos + 1) {
        match token {
            Token::DateSecond1 | Token::DateSecond2 | Token::ElapsedSeconds => return true,
            Token::Literal(_) | Token::SkipWidth(_) | Token::Color(_) | Token::Condition(_) => {}
            t if is_datetime_token(t) => return false,
            _ => return false,
        }
    }
    false
}

/// Analyze tokens: reclassify trailing commas, compute metadata.
#[allow(clippy::too_many_lines)] // section analysis has many interrelated steps
fn analyze_section(mut tokens: Vec<Token>) -> FormatSection {
    let has_datetime = tokens.iter().any(is_datetime_token);
    let is_text_section = tokens.iter().any(|t| matches!(t, Token::TextPlaceholder))
        && !tokens
            .iter()
            .any(|t| is_digit_placeholder(t) || matches!(t, Token::DecimalPoint));

    // In date/time sections, commas, decimal points, and other numeric tokens are literals.
    if has_datetime {
        for tok in &mut tokens {
            match tok {
                Token::ThousandsSep => *tok = Token::Literal(",".to_string()),
                Token::DecimalPoint => *tok = Token::Literal(".".to_string()),
                _ => {}
            }
        }
    }

    let has_percent = tokens.iter().any(|t| matches!(t, Token::Percent));
    let has_exponent = tokens.iter().any(|t| matches!(t, Token::Exponent { .. }));

    // Find last digit placeholder index
    let last_digit_idx = tokens.iter().rposition(is_digit_placeholder);

    // Reclassify trailing commas after last digit placeholder as ScaleDivisor
    let mut scale_divisors = 0u32;
    if let Some(last_idx) = last_digit_idx {
        let mut j = last_idx + 1;
        while j < tokens.len() {
            if matches!(tokens[j], Token::ThousandsSep) {
                tokens[j] = Token::ScaleDivisor;
                scale_divisors += 1;
                j += 1;
            } else if matches!(tokens[j], Token::DecimalPoint) {
                break; // decimals follow -- commas before decimal are not scale divisors in this context
            } else {
                break;
            }
        }
    }

    // Detect thousands separator: a ThousandsSep between digit placeholders before decimal
    let has_thousands = {
        let mut seen_digit = false;
        let mut before_dec = true;
        let mut found = false;
        for tok in &tokens {
            match tok {
                Token::DecimalPoint | Token::Exponent { .. } => {
                    before_dec = false;
                }
                t if is_digit_placeholder(t) && before_dec => {
                    if seen_digit { /* additional digit */
                    } else {
                        seen_digit = true;
                    }
                }
                Token::ThousandsSep if before_dec && seen_digit => {
                    found = true;
                }
                _ => {}
            }
        }
        found
    };

    // Count integer and decimal digit placeholders
    let mut before_dec = true;
    let mut int_placeholders = 0usize;
    let mut dec_placeholders = 0usize;
    let mut has_digit_placeholders = false;
    // For exponent formats, split at Exponent token
    let mut past_exponent = false;
    for tok in &tokens {
        if matches!(tok, Token::Exponent { .. }) {
            past_exponent = true;
            continue;
        }
        if past_exponent {
            continue;
        } // exponent digits are counted separately
        match tok {
            Token::DecimalPoint => {
                before_dec = false;
            }
            t if is_digit_placeholder(t) => {
                has_digit_placeholders = true;
                if before_dec {
                    int_placeholders += 1;
                } else {
                    dec_placeholders += 1;
                }
            }
            _ => {}
        }
    }

    // Extract color directive
    let color = tokens.iter().find_map(|t| {
        if let Token::Color(c) = t {
            Some(c.clone())
        } else {
            None
        }
    });

    FormatSection {
        tokens,
        is_datetime: has_datetime,
        is_text_section,
        scale_divisors,
        has_percent,
        has_exponent,
        has_thousands,
        int_placeholders,
        dec_placeholders,
        has_digit_placeholders,
        color,
    }
}
