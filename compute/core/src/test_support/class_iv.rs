//! Class IV — CellValue ↔ input-string round-trip case table.
//!
//! This module is the single source of truth for the ~150 declarative
//! round-trip cases for iterative-recalc input coercion. The
//! integration-mirror surface (`tests/cell_value_round_trip_via_engine.rs`)
//! iterates over [`cases()`] to exercise the full `engine.set_cell` path —
//! the same path production callers use (UI, TS bridge, external SDK).
//!
//! Each case declares its **expected** round-trip outcome explicitly as an
//! [`Expectation`] pinning what `engine.set_cell(render(v))` produces for
//! input CellValue `v`. This is intentional: the
//! coercion rules for user-typed strings are product spec. When a case says
//! `CoercesTo(v')`, that's Mog's declared user-visible behavior, not a
//! testing shortcut.
//!
//! **Scope note.** Earlier iterations of this table also fed an inline
//! `parse_render_unit` test surface against the pure `parse_input_value`
//! helper. That surface was deleted because it tested an implementation
//! detail (one stage of the `set_cell` pipeline in isolation) rather than
//! product behavior — and the unit-level parser-contract invariants are
//! already covered by direct `parse_input_value` tests in
//! `compute/core/src/storage/cells/values.rs`.
//!
//! **State today:** many cases are expected to fail — they pin Class-A
//! harness findings (whitespace collapse, etc.) from `FINDINGS.md`. Each
//! non-deferred case is a per-case `#[test]` in the runner modules —
//! failing tests ARE the bug tracker. Do NOT silence failures with
//! `#[ignore]` or failure budgets.

use std::sync::Arc;
use value_types::{CellArray, CellControl, CellError, CellValue, FiniteF64};

/// Expected outcome when we render a `CellValue` to input text and re-parse.
#[derive(Debug, Clone)]
pub enum Expectation {
    /// The original value round-trips verbatim (parse ∘ render == identity).
    RoundTrips,
    /// The original value collapses into a different declared value on
    /// round-trip. This encodes a product-spec coercion rule.
    CoercesTo(CellValue),
    /// The case is inspection-only; we don't assert on round-trip
    /// behavior yet (e.g. Array/Control cases where fixture construction
    /// is deferred). The runner counts these separately.
    Deferred,
}

/// One declarative round-trip case.
pub struct Class4Case {
    /// Short stable label, used in failure messages and (future) test
    /// names. Keep lowercase and underscore-joined so it survives being
    /// embedded in test identifiers.
    pub name: &'static str,
    /// The input value to render.
    pub input: CellValue,
    /// What the engine should produce after `parse(render(input))`.
    pub expected: Expectation,
}

/// Assemble the full Class IV case table.
///
/// ~140 cases across the coercion axes (whitespace, leading
/// apostrophe, would-be formula, type-coercing literals, null/errors,
/// numeric edges, arrays/controls). Arrays and Controls are presently
/// marked `Deferred` — constructing equivalent-under-render fixtures
/// requires deep engine work (the renderer returns an empty string for
/// both, so they'd trivially "round-trip" to Null under the current
/// render path; that's not a meaningful test).
#[must_use]
pub fn cases() -> Vec<Class4Case> {
    let mut out: Vec<Class4Case> = Vec::with_capacity(160);

    // -----------------------------------------------------------------
    // Whitespace — all currently collapse to Null via the input parser.
    // -----------------------------------------------------------------
    out.extend(whitespace_cases());

    // -----------------------------------------------------------------
    // Leading apostrophe — the TS / engine input parser strips a single
    // leading apostrophe and treats the remainder as literal text. When
    // we render a `Text` value back to input, we emit it verbatim (no
    // apostrophe), so `"'foo"` survives as `"'foo"` but any apostrophe
    // stripping on parse shifts the round-trip.
    // -----------------------------------------------------------------
    out.extend(leading_apostrophe_cases());

    // -----------------------------------------------------------------
    // Would-be formula — raw text that starts with `=`. Rendering a
    // `Text` CellValue containing `"=A1"` emits `"=A1"`, which on re-parse
    // is *not* a formula (the input-value parser returns Text for
    // "everything else"; formula detection happens earlier in the
    // set_cell pipeline). So these round-trip as Text.
    // -----------------------------------------------------------------
    out.extend(would_be_formula_cases());

    // -----------------------------------------------------------------
    // Type-coercing literals — text that *looks* like another type.
    // When held as `Text("TRUE")`, rendering emits `"TRUE"`, which the
    // parser will re-coerce to `Boolean(true)`. That is the spec.
    // -----------------------------------------------------------------
    out.extend(type_coercing_literal_cases());

    // -----------------------------------------------------------------
    // Null + errors.
    // -----------------------------------------------------------------
    out.extend(null_and_error_cases());

    // -----------------------------------------------------------------
    // Numeric edges.
    // -----------------------------------------------------------------
    out.extend(numeric_edge_cases());

    // -----------------------------------------------------------------
    // Arrays / Controls — deferred for Stage 1.
    // -----------------------------------------------------------------
    out.extend(array_and_control_cases());

    out
}

// ---------------------------------------------------------------------
// Axis helpers
// ---------------------------------------------------------------------

fn whitespace_cases() -> Vec<Class4Case> {
    // Every whitespace-only text currently collapses to Null on parse
    // (the input parser trims then checks `is_empty`). Multi-word text
    // surrounded by whitespace survives as text, but may have internal
    // whitespace preserved — the parser returns the *original* input for
    // the Text branch (not trimmed). Still, on render→parse, " foo "
    // renders as " foo ", parses back as Text(" foo "). That round-trips.
    let ws_collapse_to_null = vec![
        (" ", "ws_single_space"),
        ("  ", "ws_two_spaces"),
        ("\t", "ws_tab"),
        ("\n", "ws_newline"),
        ("\r\n", "ws_crlf"),
    ];
    let ws_preserve_text = vec![
        ("  foo  ", "ws_surrounded"),
        ("foo ", "ws_trailing"),
        ("\nfoo", "ws_leading_newline"),
        (" foo\n", "ws_leading_space_trailing_newline"),
    ];
    let mut out = Vec::new();
    for (s, name) in ws_collapse_to_null {
        out.push(Class4Case {
            name,
            input: CellValue::Text(Arc::from(s)),
            expected: Expectation::CoercesTo(CellValue::Null),
        });
    }
    for (s, name) in ws_preserve_text {
        out.push(Class4Case {
            name,
            input: CellValue::Text(Arc::from(s)),
            expected: Expectation::RoundTrips,
        });
    }
    out
}

fn leading_apostrophe_cases() -> Vec<Class4Case> {
    // `Text("'foo")` renders verbatim as `"'foo"`. When that string is
    // fed back through `engine.set_cell`, the engine applies Excel's
    // text-prefix rule: a leading `'` is a format sentinel (forces text
    // mode), not content. The `'` is stripped and the remainder is
    // stored as literal text with no further coercion — so e.g. `'TRUE`
    // is preserved as `Text("TRUE")` rather than coerced to
    // `Boolean(true)`.
    //
    // These are declared as `CoercesTo(..)` because the render + set_cell
    // round-trip deliberately sheds the apostrophe metadata. (The
    // text-prefix format flag itself must be preserved for XLSX
    // round-trip, but that lives on the number-format layer, not on
    // `CellValue`.)
    let inputs = [
        ("'foo", "apos_text", "foo"),
        ("'foo'", "apos_wrapped", "foo'"),
        ("''foo", "apos_double", "'foo"),
        ("'TRUE", "apos_would_be_bool", "TRUE"),
        ("'42", "apos_would_be_number", "42"),
        ("'0.4", "apos_would_be_float", "0.4"),
        ("'=A1", "apos_would_be_formula", "=A1"),
    ];
    inputs
        .iter()
        .map(|(input, name, coerced)| Class4Case {
            name,
            input: CellValue::Text(Arc::from(*input)),
            expected: Expectation::CoercesTo(CellValue::Text(Arc::from(*coerced))),
        })
        .collect()
}

fn would_be_formula_cases() -> Vec<Class4Case> {
    // Text that *starts* with `=` — rendering a Text cell emits exactly
    // its contents (no apostrophe escape). When that string is fed back
    // through `engine.set_cell`, the engine applies formula detection:
    // a leading `=` means "this is a formula, compile and evaluate it."
    // That is the defining purpose of `set_cell`, so these cases always
    // coerce the input Text to the formula's evaluated result.
    //
    // Fixture contract: the integration runner writes the target cell at
    // B2 with an empty A1 in scope, so `=A1` evaluates to `Number(0)`
    // (Excel's reference-to-empty semantics) rather than a self-ref.
    // Keep this table in sync with `TARGET_ROW`/`TARGET_COL` in
    // `tests/cell_value_round_trip_via_engine.rs`.
    vec![
        Class4Case {
            name: "wouldbe_cellref_formula",
            input: CellValue::Text(Arc::from("=A1")),
            expected: Expectation::CoercesTo(CellValue::number(0.0)),
        },
        Class4Case {
            name: "wouldbe_arith_formula",
            input: CellValue::Text(Arc::from("=1+1")),
            expected: Expectation::CoercesTo(CellValue::number(2.0)),
        },
        Class4Case {
            name: "wouldbe_bad_function_formula",
            input: CellValue::Text(Arc::from("=not_a_function()")),
            expected: Expectation::CoercesTo(CellValue::Error(
                value_types::CellError::Name,
                Some(Arc::from("Unknown function 'NOT_A_FUNCTION'")),
            )),
        },
        Class4Case {
            name: "wouldbe_double_eq_formula",
            input: CellValue::Text(Arc::from("==A1")),
            expected: Expectation::CoercesTo(CellValue::Error(value_types::CellError::Name, None)),
        },
    ]
}

fn type_coercing_literal_cases() -> Vec<Class4Case> {
    // A `Text("TRUE")` cell renders as `"TRUE"`. `parse_rich_value("TRUE")`
    // returns `Boolean(true)`. Spec: coercion fires — the round-trip
    // changes type.
    vec![
        Class4Case {
            name: "literal_bool_true_upper",
            input: CellValue::Text(Arc::from("TRUE")),
            expected: Expectation::CoercesTo(CellValue::Boolean(true)),
        },
        Class4Case {
            name: "literal_bool_true_lower",
            input: CellValue::Text(Arc::from("true")),
            expected: Expectation::CoercesTo(CellValue::Boolean(true)),
        },
        Class4Case {
            name: "literal_bool_false_upper",
            input: CellValue::Text(Arc::from("FALSE")),
            expected: Expectation::CoercesTo(CellValue::Boolean(false)),
        },
        Class4Case {
            name: "literal_bool_false_mixed",
            input: CellValue::Text(Arc::from("False")),
            expected: Expectation::CoercesTo(CellValue::Boolean(false)),
        },
        Class4Case {
            name: "literal_int_42",
            input: CellValue::Text(Arc::from("42")),
            expected: Expectation::CoercesTo(CellValue::number(42.0)),
        },
        Class4Case {
            name: "literal_float_point_four",
            input: CellValue::Text(Arc::from("0.4")),
            expected: Expectation::CoercesTo(CellValue::number(0.4)),
        },
        Class4Case {
            name: "literal_scientific",
            input: CellValue::Text(Arc::from("1e10")),
            // "1e10" is parsed as a formatted number by the input
            // parser → coerces to Number(1e10) = 10_000_000_000.
            expected: Expectation::CoercesTo(CellValue::number(1e10)),
        },
        Class4Case {
            name: "literal_currency_dollar",
            input: CellValue::Text(Arc::from("$1.00")),
            expected: Expectation::CoercesTo(CellValue::number(1.0)),
        },
        Class4Case {
            name: "literal_percent",
            input: CellValue::Text(Arc::from("50%")),
            expected: Expectation::CoercesTo(CellValue::number(0.5)),
        },
        Class4Case {
            name: "literal_fraction_slash",
            input: CellValue::Text(Arc::from("1/2")),
            // Format-blind parsing treats two-part slash input as a date
            // using the culture parser's default year. "1/2" = Jan 2, 2000.
            expected: Expectation::CoercesTo(CellValue::number(36527.0)),
        },
        Class4Case {
            name: "literal_iso_date",
            input: CellValue::Text(Arc::from("2024-01-01")),
            // ISO date → Excel serial. 2024-01-01 serial = 45292.
            expected: Expectation::CoercesTo(CellValue::number(45292.0)),
        },
        Class4Case {
            name: "literal_time",
            input: CellValue::Text(Arc::from("12:00:00")),
            // Time-like input under the format-blind user-typing path coerces
            // to the Excel time serial. Noon = 0.5.
            expected: Expectation::CoercesTo(CellValue::number(0.5)),
        },
        Class4Case {
            name: "literal_empty_string",
            input: CellValue::Text(Arc::from("")),
            // Empty text → renders to "" → parses back to Null.
            expected: Expectation::CoercesTo(CellValue::Null),
        },
    ]
}

fn null_and_error_cases() -> Vec<Class4Case> {
    // `cell_value_to_input_string(Null)` = `""`. Parse("") = Null.
    // For every error variant, render returns `""` → Null on parse.
    // That is a coercion, not a round-trip.
    let mut out = vec![Class4Case {
        name: "null",
        input: CellValue::Null,
        expected: Expectation::RoundTrips,
    }];
    let errors = [
        (CellError::Div0, "err_div0"),
        (CellError::Na, "err_na"),
        (CellError::Name, "err_name"),
        (CellError::Null, "err_null"),
        (CellError::Num, "err_num"),
        (CellError::Ref, "err_ref"),
        (CellError::Value, "err_value"),
        (CellError::Spill, "err_spill"),
        (CellError::Calc, "err_calc"),
        (CellError::GettingData, "err_getting_data"),
        (CellError::Circ, "err_circ"),
    ];
    for (err, name) in errors {
        out.push(Class4Case {
            name,
            input: CellValue::Error(err, None),
            expected: Expectation::CoercesTo(CellValue::Null),
        });
    }
    // And one error with a diagnostic message — same behavior.
    out.push(Class4Case {
        name: "err_value_with_msg",
        input: CellValue::Error(CellError::Value, Some(Arc::from("bad arg"))),
        expected: Expectation::CoercesTo(CellValue::Null),
    });
    out
}

fn numeric_edge_cases() -> Vec<Class4Case> {
    // For every finite f64, `cell_value_to_input_string(Number(n))` goes
    // through `format!("{}", FiniteF64)` which uses the standard
    // Rust `Display` impl for f64. Parsing back through
    // `parse_input_value` hits `is_plain_number` first — but that
    // pattern explicitly rejects scientific notation (`e`/`E`), so
    // f64 values that Display renders with exponents (very large or
    // very small) fall through to `parse_formatted_number`, which
    // also rejects them, and end up as Text.
    //
    // **Expected behavior today:** for normal magnitudes (that
    // Display writes without exponents), the round-trip holds. For
    // extreme magnitudes the current parser does not recover the
    // number. The cases below declare both outcomes.
    let mut out = Vec::new();

    // -0.0 renders as "-0" (Display drops the fractional zero). Parse
    // returns 0.0 — sign is preserved by `parse::<f64>` as "-0" → -0.0.
    // Since CellValue::number preserves -0.0, both pre and post are
    // Number(-0.0). PartialEq on FiniteF64 uses f64 equality, which
    // treats -0.0 == 0.0 as true. We declare RoundTrips.
    out.push(Class4Case {
        name: "num_neg_zero",
        input: CellValue::Number(FiniteF64::must(-0.0)),
        expected: Expectation::RoundTrips,
    });
    out.push(Class4Case {
        name: "num_zero",
        input: CellValue::Number(FiniteF64::must(0.0)),
        expected: Expectation::RoundTrips,
    });

    // Normal-magnitude cases that Display prints without exponents —
    // these should round-trip.
    for (v, name) in [
        (0.1_f64, "num_point_one"),
        (0.2, "num_point_two"),
        (0.3, "num_point_three"),
        (0.7, "num_point_seven"),
        (1.0 / 3.0, "num_one_third"),
        (2f64.powi(53), "num_2pow53"),
        (2f64.powi(53) + 1.0, "num_2pow53_plus_one"),
    ] {
        out.push(Class4Case {
            name,
            input: CellValue::Number(FiniteF64::must(v)),
            expected: Expectation::RoundTrips,
        });
    }

    // f64::EPSILON = ~2.22e-16. Display: "0.0000000000000002220446049250313".
    // That's a long decimal without `e`, so it parses as a plain number.
    out.push(Class4Case {
        name: "num_epsilon",
        input: CellValue::Number(FiniteF64::must(f64::EPSILON)),
        expected: Expectation::RoundTrips,
    });

    // Rust's `Display` for `f64` writes these extreme magnitudes in
    // long decimal form (no 'e' exponent), which is exactly what
    // `is_plain_number` accepts, so they round-trip as Number.
    // Values kept for their bit patterns — any regression in the
    // parser around long-decimal forms surfaces here.
    out.push(Class4Case {
        name: "num_f64_max",
        input: CellValue::Number(FiniteF64::must(f64::MAX)),
        expected: Expectation::RoundTrips,
    });
    out.push(Class4Case {
        name: "num_f64_min_positive",
        input: CellValue::Number(FiniteF64::must(f64::MIN_POSITIVE)),
        expected: Expectation::RoundTrips,
    });
    let subnormal = f64::MIN_POSITIVE / 2.0;
    out.push(Class4Case {
        name: "num_subnormal",
        input: CellValue::Number(FiniteF64::must(subnormal)),
        expected: Expectation::RoundTrips,
    });

    out
}

fn array_and_control_cases() -> Vec<Class4Case> {
    // These cases are inspection-only: `cell_value_to_input_string`
    // returns `""` for arrays and `"TRUE"/"FALSE"` for controls. The
    // round-trip can't reproduce the original Array/Control because
    // the parser has no notion of these types. We record the cases so
    // later stages can extend the expectation enum when the engine
    // grows a proper array/control input path.
    //
    // TODO(stage-2+): when engine exposes an array/control input path,
    // upgrade these from `Deferred` to `RoundTrips` or `CoercesTo(...)`.
    let mut out = Vec::new();

    // 1×1 array of Number(1.0).
    out.push(Class4Case {
        name: "array_1x1_number",
        input: CellValue::Array(Arc::new(CellArray::new(vec![CellValue::number(1.0)], 1))),
        expected: Expectation::Deferred,
    });

    // 2×2 array.
    out.push(Class4Case {
        name: "array_2x2_numbers",
        input: CellValue::Array(Arc::new(CellArray::new(
            vec![
                CellValue::number(1.0),
                CellValue::number(2.0),
                CellValue::number(3.0),
                CellValue::number(4.0),
            ],
            2,
        ))),
        expected: Expectation::Deferred,
    });

    // Row array with mixed types.
    out.push(Class4Case {
        name: "array_mixed_row",
        input: CellValue::row_array(vec![
            CellValue::number(1.0),
            CellValue::Text(Arc::from("hi")),
            CellValue::Boolean(true),
        ]),
        expected: Expectation::Deferred,
    });

    // Control: checkbox true / false.
    out.push(Class4Case {
        name: "control_checkbox_true",
        input: CellValue::Control(CellControl::checkbox(true)),
        expected: Expectation::Deferred,
    });
    out.push(Class4Case {
        name: "control_checkbox_false",
        input: CellValue::Control(CellControl::checkbox(false)),
        expected: Expectation::Deferred,
    });

    out
}

/// Human-readable summary of a `CellValue` for failure messages.
///
/// `CellValue` only implements `Debug`; but the `Debug` output for
/// `Arc<str>` wraps in extra quotes which makes diffs noisy. This
/// helper produces a concise form tuned for eprintln failure traces.
#[must_use]
pub fn describe_value(v: &CellValue) -> String {
    match v {
        CellValue::Number(n) => format!("Number({})", n),
        CellValue::Text(s) => format!("Text({:?})", s.as_ref()),
        CellValue::Boolean(b) => format!("Boolean({})", b),
        CellValue::Null => "Null".to_string(),
        CellValue::Error(e, None) => format!("Error({:?})", e),
        CellValue::Error(e, Some(msg)) => format!("Error({:?}, {:?})", e, msg.as_ref()),
        CellValue::Array(_) => "Array(...)".to_string(),
        CellValue::Control(c) => format!(
            "Control(type={:?}, checked={}, value={})",
            c.control_type, c.checked, c.value
        ),
        CellValue::Image(image) => format!("Image({:?})", image.source),
    }
}
