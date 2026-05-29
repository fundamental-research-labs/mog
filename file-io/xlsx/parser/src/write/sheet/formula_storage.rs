use std::borrow::Cow;

const XLFN_PREFIX: &str = "_xlfn.";
const XLWS_PREFIX: &str = "_xlfn._xlws.";

/// Convert Mog's normalized formula text to Excel's OOXML storage function names.
///
/// Excel stores post-ISO/ECMA functions using `_xlfn.` and a small worksheet-only
/// subset using `_xlfn._xlws.`. The parser intentionally strips those prefixes for
/// evaluation, but the XLSX writer must re-emit them for package fidelity and
/// compatibility with consumers that read OOXML formulas directly.
pub(super) fn canonicalize_formula_for_ooxml(formula: &str) -> Cow<'_, str> {
    if formula.is_empty() {
        return Cow::Borrowed(formula);
    }

    let bytes = formula.as_bytes();
    let mut out: Option<String> = None;
    let mut last = 0;
    let mut i = 0;
    let mut in_string = false;
    let mut in_sheet_quote = false;

    while i < bytes.len() {
        let b = bytes[i];

        if in_string {
            if b == b'"' {
                if bytes.get(i + 1) == Some(&b'"') {
                    i += 2;
                    continue;
                }
                in_string = false;
            }
            i += 1;
            continue;
        }

        if in_sheet_quote {
            if b == b'\'' {
                if bytes.get(i + 1) == Some(&b'\'') {
                    i += 2;
                    continue;
                }
                in_sheet_quote = false;
            }
            i += 1;
            continue;
        }

        match b {
            b'"' => {
                in_string = true;
                i += 1;
            }
            b'\'' => {
                in_sheet_quote = true;
                i += 1;
            }
            _ if is_formula_identifier_start(b) => {
                let start = i;
                i += 1;
                while i < bytes.len() && is_formula_identifier_continue(bytes[i]) {
                    i += 1;
                }

                // Identifier scanning only advances across ASCII bytes, so these are UTF-8 boundaries.
                #[allow(clippy::string_slice)]
                let name = &formula[start..i];
                let mut after = i;
                while bytes.get(after).is_some_and(u8::is_ascii_whitespace) {
                    after += 1;
                }

                if bytes.get(after) == Some(&b'(')
                    && !has_excel_storage_prefix(name)
                    && let Some(prefix) = storage_prefix_for_function(name)
                {
                    let output =
                        out.get_or_insert_with(|| String::with_capacity(formula.len() + 16));
                    // `last` and `start` are ASCII token boundaries from this scanner.
                    #[allow(clippy::string_slice)]
                    output.push_str(&formula[last..start]);
                    output.push_str(prefix);
                    output.push_str(name);
                    last = i;
                }
            }
            _ => {
                i += 1;
            }
        }
    }

    if let Some(mut output) = out {
        // `last` is an ASCII token boundary from this scanner.
        #[allow(clippy::string_slice)]
        output.push_str(&formula[last..]);
        Cow::Owned(output)
    } else {
        Cow::Borrowed(formula)
    }
}

fn has_excel_storage_prefix(name: &str) -> bool {
    name.get(..XLFN_PREFIX.len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(XLFN_PREFIX))
        || name
            .get(..XLWS_PREFIX.len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(XLWS_PREFIX))
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

fn is_formula_identifier_start(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_'
}

fn is_formula_identifier_continue(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_')
}

// Source: Microsoft MS-XLSX 2.2.3 Functions future-function-list.
// Names listed without `_xlfn.` in that spec are worksheet-only grammar names and
// intentionally remain unprefixed here.
const XLWS_FUTURE_FUNCTIONS: &[&str] = &["FILTER", "PY", "SORT"];

const XLFN_FUTURE_FUNCTIONS: &[&str] = &[
    "ACOT",
    "ACOTH",
    "AGGREGATE",
    "ARABIC",
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
    "FORMULATEXT",
    "GAMMA",
    "GAMMA.DIST",
    "GAMMA.INV",
    "GAMMALN.PRECISE",
    "GAUSS",
    "HSTACK",
    "HYPGEOM.DIST",
    "IFNA",
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
    "SKEW.P",
    "SORTBY",
    "STDEV.P",
    "STDEV.S",
    "T.DIST",
    "T.DIST.2T",
    "T.DIST.RT",
    "T.INV",
    "T.INV.2T",
    "T.TEST",
    "TAKE",
    "TEXTAFTER",
    "TEXTBEFORE",
    "TEXTSPLIT",
    "TOCOL",
    "TOROW",
    "UNICHAR",
    "UNICODE",
    "UNIQUE",
    "VAR.P",
    "VAR.S",
    "VSTACK",
    "WEBSERVICE",
    "WEIBULL.DIST",
    "WRAPCOLS",
    "WRAPROWS",
    "XLOOKUP",
    "XOR",
    "Z.TEST",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefixes_future_functions_outside_strings() {
        assert_eq!(
            canonicalize_formula_for_ooxml(
                r#"IF(A1="_xlfn.XLOOKUP(A1,A:A,B:B)",XLOOKUP(A1,A:A,B:B),FILTER(A:A,B:B=1))"#
            ),
            r#"IF(A1="_xlfn.XLOOKUP(A1,A:A,B:B)",_xlfn.XLOOKUP(A1,A:A,B:B),_xlfn._xlws.FILTER(A:A,B:B=1))"#
        );
    }

    #[test]
    fn does_not_double_prefix_existing_storage_names() {
        assert_eq!(
            canonicalize_formula_for_ooxml(
                "_xlfn.XLOOKUP(A1,A:A,B:B)+_xlfn._xlws.FILTER(A:A,B:B=1)"
            ),
            "_xlfn.XLOOKUP(A1,A:A,B:B)+_xlfn._xlws.FILTER(A:A,B:B=1)"
        );
    }

    #[test]
    fn leaves_standard_and_unprefixed_future_grammar_functions_unprefixed() {
        assert_eq!(
            canonicalize_formula_for_ooxml(
                "SUM(A1:A5)+SUMIFS(A:A,B:B,1)+IFERROR(A1,0)+AVERAGEIFS(A:A,B:B,1)+COUNTIFS(A:A,1)+MINIFS(A:A,B:B,1)+MAXIFS(A:A,B:B,1)+IFS(A1>0,1)+SWITCH(A1,1,2)+CONCAT(A1,B1)+TEXTJOIN(\",\",TRUE,A:A)+FORECAST.ETS(A1,B:B,C:C)+WORKDAY.INTL(A1,1)+NETWORKDAYS.INTL(A1,A2)"
            ),
            "SUM(A1:A5)+SUMIFS(A:A,B:B,1)+IFERROR(A1,0)+AVERAGEIFS(A:A,B:B,1)+COUNTIFS(A:A,1)+MINIFS(A:A,B:B,1)+MAXIFS(A:A,B:B,1)+IFS(A1>0,1)+SWITCH(A1,1,2)+CONCAT(A1,B1)+TEXTJOIN(\",\",TRUE,A:A)+FORECAST.ETS(A1,B:B,C:C)+WORKDAY.INTL(A1,1)+NETWORKDAYS.INTL(A1,A2)"
        );
    }

    #[test]
    fn prefixes_every_listed_xlfn_function() {
        for name in XLFN_FUTURE_FUNCTIONS {
            let formula = format!("{name}(A1)");
            let expected = format!("_xlfn.{name}(A1)");
            assert_eq!(canonicalize_formula_for_ooxml(&formula), expected);
        }
    }

    #[test]
    fn prefixes_newly_listed_xlfn_functions() {
        assert_eq!(
            canonicalize_formula_for_ooxml("COPILOT(A1)+LONGTEXT(A1)"),
            "_xlfn.COPILOT(A1)+_xlfn.LONGTEXT(A1)"
        );
    }

    #[test]
    fn prefixes_every_listed_xlws_function() {
        for name in XLWS_FUTURE_FUNCTIONS {
            let formula = format!("{name}(A1)");
            let expected = format!("_xlfn._xlws.{name}(A1)");
            assert_eq!(canonicalize_formula_for_ooxml(&formula), expected);
        }
    }
}
