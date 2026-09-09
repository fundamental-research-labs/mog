// All string slices use boundaries recorded by char_indices or ASCII prefix lengths.
#![allow(clippy::string_slice)]

use std::borrow::Cow;
use std::ops::Range;

const XLFN_PREFIX: &str = "_xlfn.";
const XLWS_PREFIX: &str = "_xlfn._xlws.";
const XLPM_PREFIX: &str = "_xlpm.";

/// Restore Excel storage prefixes without changing formula spelling or whitespace.
/// Local names require lexical scopes: LET names become visible after their value,
/// while LAMBDA parameters are visible in its body. Workbook names, sheet/table
/// references and quoted text must not acquire local-parameter prefixes.
pub(super) fn canonicalize_formula_for_ooxml(formula: &str) -> Cow<'_, str> {
    let tokens = tokenize(formula);
    let mut closes = vec![None; tokens.len()];
    let mut stack = Vec::new();
    for (i, token) in tokens.iter().enumerate() {
        match token.text {
            "(" | "{" => stack.push(i),
            ")" | "}" => {
                if let Some(open) = stack.pop() {
                    closes[open] = Some(i);
                }
            }
            _ => {}
        }
    }

    let mut bindings: Vec<Binding<'_>> = Vec::new();
    for (i, token) in tokens.iter().enumerate() {
        let name = without_prefix(token.text, XLFN_PREFIX);
        if !token.identifier
            || is_qualified(&tokens, i)
            || is_bound(&bindings, token.text, i)
            || !(name.eq_ignore_ascii_case("LET") || name.eq_ignore_ascii_case("LAMBDA"))
            || tokens.get(i + 1).map(|t| t.text) != Some("(")
        {
            continue;
        }
        let open = i + 1;
        let Some(close) = closes[open] else { continue };
        let args = arguments(&tokens, &closes, open, close);
        let is_let = name.eq_ignore_ascii_case("LET");
        if args.is_empty() || (is_let && (args.len() < 3 || args.len().is_multiple_of(2))) {
            continue;
        }
        for a in (0..args.len() - 1).step_by(if is_let { 2 } else { 1 }) {
            let declaration = args[a].start;
            if args[a].len() != 1 || !tokens[declaration].identifier {
                continue;
            }
            bindings.push(Binding {
                name: without_prefix(tokens[declaration].text, XLPM_PREFIX),
                declaration,
                scope: if is_let {
                    args[a + 1].end + 1..close
                } else {
                    args[args.len() - 1].start..close
                },
            });
        }
    }

    let mut out = String::new();
    let mut last = 0;
    for (i, token) in tokens.iter().enumerate() {
        if !token.identifier || is_qualified(&tokens, i) {
            continue;
        }
        let prefix = if is_bound(&bindings, token.text, i) {
            (!has_prefix(token.text, XLPM_PREFIX)).then_some(XLPM_PREFIX)
        } else if tokens.get(i + 1).map(|t| t.text) == Some("(")
            && !has_prefix(token.text, XLFN_PREFIX)
            && !has_prefix(token.text, XLPM_PREFIX)
        {
            storage_prefix_for_function(token.text)
        } else {
            None
        };
        if let Some(prefix) = prefix {
            out.push_str(&formula[last..token.start]);
            out.push_str(prefix);
            last = token.start;
        }
    }
    if out.is_empty() {
        Cow::Borrowed(formula)
    } else {
        out.push_str(&formula[last..]);
        Cow::Owned(out)
    }
}

struct Binding<'a> {
    name: &'a str,
    declaration: usize,
    scope: Range<usize>,
}

fn is_bound(bindings: &[Binding<'_>], name: &str, i: usize) -> bool {
    bindings.iter().any(|binding| {
        binding
            .name
            .eq_ignore_ascii_case(without_prefix(name, XLPM_PREFIX))
            && (binding.declaration == i || binding.scope.contains(&i))
    })
}

fn has_prefix(name: &str, prefix: &str) -> bool {
    name.get(..prefix.len())
        .is_some_and(|s| s.eq_ignore_ascii_case(prefix))
}

fn without_prefix<'a>(name: &'a str, prefix: &str) -> &'a str {
    if has_prefix(name, prefix) {
        &name[prefix.len()..]
    } else {
        name
    }
}

struct Token<'a> {
    text: &'a str,
    start: usize,
    identifier: bool,
}

fn is_qualified(tokens: &[Token<'_>], i: usize) -> bool {
    let before = i.checked_sub(1).map(|i| tokens[i].text);
    let after = tokens.get(i + 1).map(|t| t.text);
    before == Some("!") || after == Some("!") || before == Some("$")
        || is_column_range(tokens, i)
        || after.is_some_and(|s| s.starts_with('['))
        || before.is_some_and(|s| s.ends_with(']'))
        // A sheet span such as Jan:Dec!A1 is a qualifier, too.
        || (after == Some(":") && tokens.get(i + 3).map(|t| t.text) == Some("!"))
}

// A local name such as x can also spell a column in X:X. Range operands
// remain reference syntax even when a LET/LAMBDA variable has that spelling.
fn is_column_range(tokens: &[Token<'_>], i: usize) -> bool {
    fn column(text: &str) -> bool {
        !text.is_empty()
            && text.len() <= 3
            && text.bytes().all(|b| b.is_ascii_alphabetic())
            && text.bytes().fold(0u32, |n, b| {
                n * 26 + u32::from(b.to_ascii_uppercase() - b'A' + 1)
            }) <= 16_384
    }
    if !column(tokens[i].text) {
        return false;
    }
    (tokens.get(i + 1).is_some_and(|t| t.text == ":")
        && tokens
            .get(i + 2)
            .is_some_and(|t| column(t.text) || t.text == "$"))
        || (i >= 2 && tokens[i - 1].text == ":" && column(tokens[i - 2].text))
}

fn arguments(
    tokens: &[Token<'_>],
    closes: &[Option<usize>],
    open: usize,
    close: usize,
) -> Vec<Range<usize>> {
    let mut args = Vec::new();
    let mut start = open + 1;
    let mut i = start;
    while i < close {
        if let Some(end) = closes[i] {
            i = end + 1;
            continue;
        }
        if tokens[i].text == "," {
            args.push(start..i);
            start = i + 1;
        }
        i += 1;
    }
    args.push(start..close);
    args
}

/// Tokenize only the syntax needed for storage names. Quoted strings, sheet
/// names, and bracketed structured/external references remain opaque tokens.
fn tokenize(formula: &str) -> Vec<Token<'_>> {
    let mut chars = formula.char_indices().peekable();
    let mut tokens = Vec::new();
    while let Some((start, ch)) = chars.next() {
        if ch.is_whitespace() {
            continue;
        }
        let identifier = ch.is_alphabetic()
            || matches!(ch, '_' | '\\')
            || (!ch.is_ascii() && !ch.is_whitespace());
        if matches!(ch, '\'' | '"') {
            while let Some((_, next)) = chars.next() {
                if next == ch {
                    if chars.peek().is_some_and(|(_, c)| *c == ch) {
                        chars.next();
                    } else {
                        break;
                    }
                }
            }
        } else if ch == '[' {
            let mut depth = 1;
            while let Some((_, next)) = chars.next() {
                match next {
                    '\'' if chars
                        .peek()
                        .is_some_and(|(_, c)| matches!(c, '[' | ']' | '#' | '\'' | '@')) =>
                    {
                        chars.next();
                    } // Structured-reference escape.
                    '[' => depth += 1,
                    ']' => {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    _ => {}
                }
            }
        } else if identifier || ch.is_ascii_digit() || ch == '.' {
            while chars.peek().is_some_and(|(_, c)| {
                c.is_alphanumeric()
                    || matches!(c, '.' | '_' | '\\')
                    || (!c.is_ascii() && !c.is_whitespace())
            }) {
                chars.next();
            }
        }
        let end = chars.peek().map_or(formula.len(), |(i, _)| *i);
        tokens.push(Token {
            text: &formula[start..end],
            start,
            identifier,
        });
    }
    tokens
}

fn storage_prefix_for_function(name: &str) -> Option<&'static str> {
    let upper = name.to_ascii_uppercase();
    if XLWS_FUTURE_FUNCTIONS.contains(&upper.as_str()) {
        Some(XLWS_PREFIX)
    } else if XLFN_FUTURE_FUNCTIONS.contains(&upper.as_str()) {
        Some(XLFN_PREFIX)
    } else {
        None
    }
}

// Storage names (not the unprefixed worksheet grammar productions):
// https://learn.microsoft.com/en-us/openspecs/office_standards/ms-xlsx/5d1b6d44-6fc1-4ecd-8fef-0b27406cc2bf
// Supplemented by XlsxWriter for ANCHORARRAY, ARRAYTOTEXT, IMAGE, SINGLE,
// VALUETOTEXT and XMATCH: https://xlsxwriter.readthedocs.io/working_with_formulas.html
const XLWS_FUTURE_FUNCTIONS: &[&str] = &["FILTER", "PY", "SORT"];

const XLFN_FUTURE_FUNCTIONS: &[&str] = &[
    "ACOT",
    "ACOTH",
    "AGGREGATE",
    "ANCHORARRAY",
    "ARABIC",
    "ARRAYTOTEXT",
    "BASE",
    "BETA.DIST",
    "BETA.INV",
    "BINOM.DIST",
    "BINOM.DIST.RANGE",
    "BINOM.INV",
    "BITAND",
    "BITLSHIFT",
    "BITOR",
    "BITRSHIFT",
    "BITXOR",
    "BYCOL",
    "BYROW",
    "CEILING.MATH",
    "CEILING.PRECISE",
    "CHISQ.DIST",
    "CHISQ.DIST.RT",
    "CHISQ.INV",
    "CHISQ.INV.RT",
    "CHISQ.TEST",
    "CHOOSECOLS",
    "CHOOSEROWS",
    "COMBINA",
    "CONCAT",
    "CONFIDENCE.NORM",
    "CONFIDENCE.T",
    "COPILOT",
    "COT",
    "COTH",
    "COVARIANCE.P",
    "COVARIANCE.S",
    "CSC",
    "CSCH",
    "DAYS",
    "DECIMAL",
    "DROP",
    "ERF.PRECISE",
    "ERFC.PRECISE",
    "EXPAND",
    "EXPON.DIST",
    "F.DIST",
    "F.DIST.RT",
    "F.INV",
    "F.INV.RT",
    "F.TEST",
    "FIELDVALUE",
    "FILTERXML",
    "FLOOR.MATH",
    "FLOOR.PRECISE",
    "FORECAST.ETS",
    "FORECAST.ETS.CONFINT",
    "FORECAST.ETS.SEASONALITY",
    "FORECAST.ETS.STAT",
    "FORECAST.LINEAR",
    "FORMULATEXT",
    "GAMMA",
    "GAMMA.DIST",
    "GAMMA.INV",
    "GAMMALN.PRECISE",
    "GAUSS",
    "HSTACK",
    "HYPGEOM.DIST",
    "IFNA",
    "IFS",
    "IMAGE",
    "IMCOSH",
    "IMCOT",
    "IMCSC",
    "IMCSCH",
    "IMSEC",
    "IMSECH",
    "IMSINH",
    "IMTAN",
    "ISFORMULA",
    "ISOMITTED",
    "ISOWEEKNUM",
    "LAMBDA",
    "LET",
    "LOGNORM.DIST",
    "LOGNORM.INV",
    "LONGTEXT",
    "MAKEARRAY",
    "MAP",
    "MAXIFS",
    "MINIFS",
    "MODE.MULT",
    "MODE.SNGL",
    "MUNIT",
    "NEGBINOM.DIST",
    "NORM.DIST",
    "NORM.INV",
    "NORM.S.DIST",
    "NORM.S.INV",
    "NUMBERVALUE",
    "PDURATION",
    "PERCENTILE.EXC",
    "PERCENTILE.INC",
    "PERCENTRANK.EXC",
    "PERCENTRANK.INC",
    "PERMUTATIONA",
    "PHI",
    "POISSON.DIST",
    "PQSOURCE",
    "PYTHON_STR",
    "PYTHON_TYPE",
    "PYTHON_TYPENAME",
    "QUARTILE.EXC",
    "QUARTILE.INC",
    "QUERYSTRING",
    "RANDARRAY",
    "RANK.AVG",
    "RANK.EQ",
    "REDUCE",
    "RRI",
    "SCAN",
    "SEC",
    "SECH",
    "SEQUENCE",
    "SHEET",
    "SHEETS",
    "SINGLE",
    "SKEW.P",
    "SORTBY",
    "STDEV.P",
    "STDEV.S",
    "SWITCH",
    "T.DIST",
    "T.DIST.RT",
    "T.INV",
    "T.TEST",
    "TAKE",
    "TEXTAFTER",
    "TEXTBEFORE",
    "TEXTJOIN",
    "TEXTSPLIT",
    "TOCOL",
    "TOROW",
    "UNICHAR",
    "UNICODE",
    "UNIQUE",
    "VALUETOTEXT",
    "VAR.P",
    "VAR.S",
    "VSTACK",
    "WEBSERVICE",
    "WEIBULL.DIST",
    "WRAPCOLS",
    "WRAPROWS",
    "XLOOKUP",
    "XMATCH",
    "XOR",
    "Z.TEST",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restores_all_reported_storage_names() {
        for name in [
            "CONCAT",
            "TEXTJOIN",
            "MAXIFS",
            "MINIFS",
            "XMATCH",
            "IFS",
            "SWITCH",
            "FORECAST.ETS",
            "FORECAST.ETS.CONFINT",
            "FORECAST.ETS.SEASONALITY",
            "FORECAST.ETS.STAT",
            "FORECAST.LINEAR",
            "ARRAYTOTEXT",
            "VALUETOTEXT",
            "IMAGE",
            "ANCHORARRAY",
            "SINGLE",
        ] {
            assert_eq!(
                canonicalize_formula_for_ooxml(&format!("{name}(A1)")),
                format!("_xlfn.{name}(A1)")
            );
        }
        assert_eq!(
            canonicalize_formula_for_ooxml(
                "SUM(A:A)+SUMIFS(A:A,B:B,1)+IFERROR(A1,0)+AVERAGEIFS(A:A,B:B,1)+COUNTIFS(A:A,1)+ECMA.CEILING(A1)+ISO.CEILING(A1)+WORKDAY.INTL(A1,1)+NETWORKDAYS.INTL(A1,A2)"
            ),
            "SUM(A:A)+SUMIFS(A:A,B:B,1)+IFERROR(A1,0)+AVERAGEIFS(A:A,B:B,1)+COUNTIFS(A:A,1)+ECMA.CEILING(A1)+ISO.CEILING(A1)+WORKDAY.INTL(A1,1)+NETWORKDAYS.INTL(A1,A2)"
        );
    }

    #[test]
    fn restores_each_known_function_and_is_idempotent() {
        for (names, prefix) in [
            (XLFN_FUTURE_FUNCTIONS, XLFN_PREFIX),
            (XLWS_FUTURE_FUNCTIONS, XLWS_PREFIX),
        ] {
            for name in names {
                let input = format!("{name}(A1)");
                let expected = format!("{prefix}{name}(A1)");
                assert_eq!(canonicalize_formula_for_ooxml(&input), expected);
                assert_eq!(canonicalize_formula_for_ooxml(&expected), expected);
            }
        }
    }

    #[test]
    fn scopes_let_names_sequentially_and_lambda_parameters_to_the_body() {
        let cases = [
            ("LET(x,10,x*2)+x", "_xlfn.LET(_xlpm.x,10,_xlpm.x*2)+x"),
            (
                "LET(x,x+1,y,x+2,x+y)+y",
                "_xlfn.LET(_xlpm.x,x+1,_xlpm.y,_xlpm.x+2,_xlpm.x+_xlpm.y)+y",
            ),
            (
                "LET(x,1,LET(x,x+1,x)+x)",
                "_xlfn.LET(_xlpm.x,1,_xlfn.LET(_xlpm.x,_xlpm.x+1,_xlpm.x)+_xlpm.x)",
            ),
            (
                "LAMBDA(x,y,x+y)(x,y)",
                "_xlfn.LAMBDA(_xlpm.x,_xlpm.y,_xlpm.x+_xlpm.y)(x,y)",
            ),
            (
                "LET(fn,LAMBDA(x,x+1),fn(2))",
                "_xlfn.LET(_xlpm.fn,_xlfn.LAMBDA(_xlpm.x,_xlpm.x+1),_xlpm.fn(2))",
            ),
            (
                "LET(SORT,LAMBDA(x,x),SORT(2))",
                "_xlfn.LET(_xlpm.SORT,_xlfn.LAMBDA(_xlpm.x,_xlpm.x),_xlpm.SORT(2))",
            ),
            (
                "LET(x,{1,2;3,4},SUM(x))",
                "_xlfn.LET(_xlpm.x,{1,2;3,4},SUM(_xlpm.x))",
            ),
            (
                "let( x , 1 , LAMBDA(y, X+y)(x) )",
                "_xlfn.let( _xlpm.x , 1 , _xlfn.LAMBDA(_xlpm.y, _xlpm.X+_xlpm.y)(_xlpm.x) )",
            ),
            ("LET(変数,2,変数+1)", "_xlfn.LET(_xlpm.変数,2,_xlpm.変数+1)"),
            ("LAMBDA(42)", "_xlfn.LAMBDA(42)"),
            (
                "LET(x,1,SUM(X:X,$X:$X,X:$X,$X:X)+x)",
                "_xlfn.LET(_xlpm.x,1,SUM(X:X,$X:$X,X:$X,$X:X)+_xlpm.x)",
            ),
            (
                "LET(cafe\u{301},2,cafe\u{301}+1)",
                "_xlfn.LET(_xlpm.cafe\u{301},2,_xlpm.cafe\u{301}+1)",
            ),
        ];
        for (input, expected) in cases {
            assert_eq!(canonicalize_formula_for_ooxml(input), expected, "{input}");
            assert_eq!(
                canonicalize_formula_for_ooxml(expected),
                expected,
                "idempotence: {input}"
            );
            assert_eq!(
                compute_parser::normalize_xlsx_formula(expected),
                format!("={input}")
            );
        }
    }

    #[test]
    fn preserves_reference_names_and_quoted_regions() {
        let input = r#"LET(x,1,x+'x'!x+x!A1+Sheet1!x+x[CONCAT(]+Table1[x]+Table1[[#Headers],[x]]+"x"+"""TEXTJOIN("""+'Bob''s SORT('!A1)+CONCAT("a","b")"#;
        let expected = r#"_xlfn.LET(_xlpm.x,1,_xlpm.x+'x'!x+x!A1+Sheet1!x+x[CONCAT(]+Table1[x]+Table1[[#Headers],[x]]+"x"+"""TEXTJOIN("""+'Bob''s SORT('!A1)+_xlfn.CONCAT("a","b")"#;
        assert_eq!(canonicalize_formula_for_ooxml(input), expected);
        assert_eq!(
            canonicalize_formula_for_ooxml("LET(Jan,1,Jan:Dec!A1+Jan)"),
            "_xlfn.LET(_xlpm.Jan,1,Jan:Dec!A1+_xlpm.Jan)"
        );
        assert_eq!(
            canonicalize_formula_for_ooxml(
                "mysort(A1)+éSORT(A1)+name.SORT(A1)+_xlfn.SORT(A1)+_XLFN._XLWS.FILTER(A1)"
            ),
            "mysort(A1)+éSORT(A1)+name.SORT(A1)+_xlfn.SORT(A1)+_XLFN._XLWS.FILTER(A1)"
        );
    }
}
