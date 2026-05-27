use super::*;
use crate::storage::YrsStorage;
use cell_types::SheetId;
use value_types::{CellError, FiniteF64};

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

fn make_cell_id(n: u128) -> CellId {
    CellId::from_raw(n)
}

/// Create a YrsStorage with a single sheet.
///
/// `add_sheet()` creates the yrs sheet sub-maps, cells, rowOrder, colOrder.
fn storage_with_sheet() -> (YrsStorage, crate::mirror::CellMirror, SheetId) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
        .unwrap();
    (storage, mirror, sheet_id)
}

/// Build a fresh `GridIndex` matching the test sheet dimensions
/// used by `storage_with_sheet()`.
fn make_grid_index(sheet_id: SheetId) -> crate::identity::GridIndex {
    crate::identity::GridIndex::new(
        sheet_id,
        100,
        26,
        std::sync::Arc::new(cell_types::IdAllocator::new()),
    )
}

// -----------------------------------------------------------------------
// Test: parse_input_value — empty
// -----------------------------------------------------------------------

#[test]
fn test_parse_empty() {
    assert_eq!(parse_input_value("", None), ParsedValue::Empty);
    assert_eq!(parse_input_value("   ", None), ParsedValue::Empty);
    assert_eq!(parse_input_value("\t", None), ParsedValue::Empty);
}

// -----------------------------------------------------------------------
// Test: parse_input_value — booleans
// -----------------------------------------------------------------------

#[test]
fn test_parse_boolean_true() {
    assert_eq!(parse_input_value("TRUE", None), ParsedValue::Boolean(true));
    assert_eq!(parse_input_value("true", None), ParsedValue::Boolean(true));
    assert_eq!(parse_input_value("True", None), ParsedValue::Boolean(true));
    assert_eq!(parse_input_value("tRuE", None), ParsedValue::Boolean(true));
}

#[test]
fn test_parse_boolean_false() {
    assert_eq!(
        parse_input_value("FALSE", None),
        ParsedValue::Boolean(false)
    );
    assert_eq!(
        parse_input_value("false", None),
        ParsedValue::Boolean(false)
    );
    assert_eq!(
        parse_input_value("False", None),
        ParsedValue::Boolean(false)
    );
}

// -----------------------------------------------------------------------
// Test: parse_input_value — plain numbers
// -----------------------------------------------------------------------

#[test]
fn test_parse_plain_integer() {
    assert_eq!(parse_input_value("42", None), ParsedValue::Number(42.0));
    assert_eq!(parse_input_value("0", None), ParsedValue::Number(0.0));
    assert_eq!(parse_input_value("-7", None), ParsedValue::Number(-7.0));
}

#[test]
fn test_parse_plain_decimal() {
    #[allow(clippy::approx_constant)]
    let expected = 3.14;
    assert_eq!(
        parse_input_value("3.14", None),
        ParsedValue::Number(expected)
    );
    assert_eq!(parse_input_value("-0.5", None), ParsedValue::Number(-0.5));
    assert_eq!(parse_input_value(".5", None), ParsedValue::Number(0.5));
}

#[test]
fn test_parse_number_with_whitespace() {
    assert_eq!(parse_input_value("  42  ", None), ParsedValue::Number(42.0));
    #[allow(clippy::approx_constant)]
    let expected = -3.14;
    assert_eq!(
        parse_input_value(" -3.14 ", None),
        ParsedValue::Number(expected)
    );
}

// -----------------------------------------------------------------------
// Test: parse_input_value — formatted numbers
// -----------------------------------------------------------------------

#[test]
fn test_parse_currency_usd() {
    assert_eq!(parse_input_value("$500", None), ParsedValue::Number(500.0));
    assert_eq!(
        parse_input_value("$1,234.56", None),
        ParsedValue::Number(1234.56)
    );
}

#[test]
fn test_parse_currency_euro() {
    assert_eq!(
        parse_input_value("\u{20AC}1.234,56", None),
        ParsedValue::Number(1234.56)
    );
}

#[test]
fn test_parse_percentage() {
    assert_eq!(parse_input_value("50%", None), ParsedValue::Number(0.5));
    assert_eq!(parse_input_value("100%", None), ParsedValue::Number(1.0));
    assert_eq!(parse_input_value("0.5%", None), ParsedValue::Number(0.005));
}

#[test]
fn test_parse_accounting_negative() {
    assert_eq!(
        parse_input_value("(500)", None),
        ParsedValue::Number(-500.0)
    );
    assert_eq!(
        parse_input_value("($1,234.56)", None),
        ParsedValue::Number(-1234.56)
    );
}

#[test]
fn test_parse_thousands_separator() {
    assert_eq!(
        parse_input_value("1,234,567", None),
        ParsedValue::Number(1_234_567.0)
    );
}

// -----------------------------------------------------------------------
// Test: parse_formatted_number directly
// -----------------------------------------------------------------------

#[test]
fn test_parse_formatted_number_empty() {
    assert_eq!(parse_formatted_number(""), None);
}

#[test]
fn test_parse_formatted_number_currency() {
    assert_eq!(parse_formatted_number("$500"), Some(500.0));
    assert_eq!(parse_formatted_number("\u{00A3}100"), Some(100.0)); // £
    assert_eq!(parse_formatted_number("\u{00A5}200"), Some(200.0)); // ¥
    assert_eq!(parse_formatted_number("\u{20B9}300"), Some(300.0)); // ₹
}

#[test]
fn test_parse_formatted_number_negative_sign() {
    assert_eq!(parse_formatted_number("-$500"), Some(-500.0));
}

#[test]
fn test_parse_formatted_number_european() {
    // European: period as thousands, comma as decimal
    assert_eq!(parse_formatted_number("1.234,56"), Some(1234.56));
}

#[test]
fn test_parse_formatted_number_us() {
    assert_eq!(parse_formatted_number("1,234.56"), Some(1234.56));
}

#[test]
fn test_parse_formatted_number_not_a_number() {
    assert_eq!(parse_formatted_number("hello"), None);
    assert_eq!(parse_formatted_number("abc"), None);
}

#[test]
fn test_parse_formatted_number_single_comma_european_decimal() {
    // "1,5" should be treated as European decimal -> 1.5
    assert_eq!(parse_formatted_number("1,5"), Some(1.5));
    assert_eq!(parse_formatted_number("1,50"), Some(1.50));
}

// -----------------------------------------------------------------------
// Test: parse_date_string
// -----------------------------------------------------------------------

#[test]
fn test_parse_date_us_format() {
    let serial = parse_date_string("3/31/2016").unwrap();
    // 2016-03-31 should be a valid serial > 0
    assert!(serial > 0.0);
    // Verify by checking known value: Jan 1 1900 = serial 1
    let jan1_1900 = parse_date_string("1/1/1900").unwrap();
    assert!((jan1_1900 - 1.0).abs() < 0.001);
}

#[test]
fn test_parse_date_iso_format() {
    let serial = parse_date_string("2016-03-31").unwrap();
    assert!(serial > 0.0);
    // Should match the US format for same date
    let us_serial = parse_date_string("3/31/2016").unwrap();
    assert!((serial - us_serial).abs() < 0.001);
}

#[test]
fn test_parse_date_dmmy_format() {
    let serial = parse_date_string("31-Mar-2016").unwrap();
    let us_serial = parse_date_string("3/31/2016").unwrap();
    assert!((serial - us_serial).abs() < 0.001);
}

#[test]
fn test_parse_date_mmmd_format() {
    let serial = parse_date_string("Mar 31, 2016").unwrap();
    let us_serial = parse_date_string("3/31/2016").unwrap();
    assert!((serial - us_serial).abs() < 0.001);
}

#[test]
fn test_parse_date_invalid() {
    assert!(parse_date_string("").is_none());
    assert!(parse_date_string("hello").is_none());
    assert!(parse_date_string("13/32/2020").is_none()); // invalid month/day
    assert!(parse_date_string("2/30/2020").is_none()); // Feb 30 doesn't exist
    assert!(parse_date_string("2/29/2019").is_none()); // Not a leap year
}

#[test]
fn test_parse_date_leap_year() {
    assert!(parse_date_string("2/29/2020").is_some()); // 2020 is a leap year
    assert!(parse_date_string("2/29/2000").is_some()); // 2000 is a leap year
}

#[test]
fn test_parse_date_boundary_years() {
    assert!(parse_date_string("1/1/1900").is_some());
    assert!(parse_date_string("12/31/2200").is_some());
    assert!(parse_date_string("1/1/1899").is_none()); // Too early
    assert!(parse_date_string("1/1/2201").is_none()); // Too late
}

#[test]
fn test_parse_date_case_insensitive_month() {
    let serial1 = parse_date_string("31-Mar-2016").unwrap();
    let serial2 = parse_date_string("31-mar-2016").unwrap();
    let serial3 = parse_date_string("31-MAR-2016").unwrap();
    assert!((serial1 - serial2).abs() < 0.001);
    assert!((serial1 - serial3).abs() < 0.001);
}

// -----------------------------------------------------------------------
// Test: parse_input_value — dates
// -----------------------------------------------------------------------

#[test]
fn test_parse_input_value_date() {
    if let ParsedValue::Number(serial) = parse_input_value("3/31/2016", None) {
        assert!(serial > 40000.0); // Excel serial for dates in 2016
    } else {
        panic!("Expected ParsedValue::Number for date input");
    }
}

// -----------------------------------------------------------------------
// Test: parse_input_value — text
// -----------------------------------------------------------------------

#[test]
fn test_parse_text() {
    assert_eq!(
        parse_input_value("hello", None),
        ParsedValue::Text("hello".to_string())
    );
    assert_eq!(
        parse_input_value("Hello World", None),
        ParsedValue::Text("Hello World".to_string())
    );
}

#[test]
fn test_parse_text_formula_not_parsed() {
    // Formulas should be returned as text (caller checks isFormula separately)
    assert_eq!(
        parse_input_value("=SUM(A1)", None),
        ParsedValue::Text("=SUM(A1)".to_string())
    );
}

// -----------------------------------------------------------------------
// Test: set_cell_value and get operations (round-trip)
// -----------------------------------------------------------------------

#[test]
fn test_set_cell_value_number() {
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    // Use the low-level set_cell to write, then use get_cell_count
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        make_cell_id(100),
        0,
        0,
        CellValue::Number(FiniteF64::must(42.0)),
        None,
        None,
    );

    // Verify via mirror
    let val = mirror.get_cell_value_at(&sheet_id, cell_types::SheetPos::new(0, 0));
    assert!(val.is_some());
    assert_eq!(*val.unwrap(), CellValue::Number(FiniteF64::must(42.0)));
}

#[test]
fn test_literal_preserves_text() {
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    let mut grid = make_grid_index(sheet_id);
    {
        let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
        set_cell_value(
            &storage,
            doc,
            sheets,
            mirror,
            &sheet_id,
            0,
            0,
            CellInput::Literal {
                text: "123".to_string(),
            },
            &*crate::storage::STORAGE_ID_ALLOC,
            &mut grid,
        );
    }
    // Stored as text "123", not number 123 — `Literal` bypasses coercion.
    let val = get_effective_value(&mirror, &sheet_id, 0, 0);
    assert_eq!(val, Some(CellValue::Text("123".into())));
}

#[test]
fn test_literal_formula_not_evaluated() {
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    let mut grid = make_grid_index(sheet_id);
    {
        let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
        set_cell_value(
            &storage,
            doc,
            sheets,
            mirror,
            &sheet_id,
            0,
            0,
            CellInput::Literal {
                text: "=SUM(A1:A10)".to_string(),
            },
            &*crate::storage::STORAGE_ID_ALLOC,
            &mut grid,
        );
    }
    // Stored as literal text, not as a formula — `Literal` bypasses parsing.
    let val = get_effective_value(&mirror, &sheet_id, 0, 0);
    assert_eq!(val, Some(CellValue::Text("=SUM(A1:A10)".into())));
}

#[test]
fn test_literal_empty_stores_as_empty_text() {
    // sub-scope/A motivating invariant: `Literal { text: "" }` is
    // structurally distinct from `Clear`. Stores `Text("")`.
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    let mut grid = make_grid_index(sheet_id);
    {
        let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
        set_cell_value(
            &storage,
            doc,
            sheets,
            mirror,
            &sheet_id,
            0,
            0,
            CellInput::Literal {
                text: String::new(),
            },
            &*crate::storage::STORAGE_ID_ALLOC,
            &mut grid,
        );
    }
    assert_eq!(
        get_effective_value(&mirror, &sheet_id, 0, 0),
        Some(CellValue::Text("".into()))
    );
}

#[test]
fn test_parse_nul_is_plain_text() {
    // sub-scope/A: `Parse { text: "\x00" }` is a plain text character,
    // not a sentinel. The NUL-prefix sentinel died with this refactor.
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    let mut grid = make_grid_index(sheet_id);
    {
        let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
        set_cell_value(
            &storage,
            doc,
            sheets,
            mirror,
            &sheet_id,
            0,
            0,
            CellInput::Parse {
                text: "\x00".to_string(),
            },
            &*crate::storage::STORAGE_ID_ALLOC,
            &mut grid,
        );
    }
    assert_eq!(
        get_effective_value(&mirror, &sheet_id, 0, 0),
        Some(CellValue::Text("\x00".into()))
    );
}

// -----------------------------------------------------------------------
// Test: set_cell_values batch
// -----------------------------------------------------------------------

#[test]
fn test_set_cell_values_batch() {
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    let mut grid = make_grid_index(sheet_id);
    {
        let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
        set_cell_values(
            &storage,
            doc,
            sheets,
            mirror,
            &sheet_id,
            vec![
                (
                    0,
                    0,
                    CellInput::Parse {
                        text: "42".to_string(),
                    },
                ),
                (
                    0,
                    1,
                    CellInput::Parse {
                        text: "hello".to_string(),
                    },
                ),
                (
                    0,
                    2,
                    CellInput::Parse {
                        text: "TRUE".to_string(),
                    },
                ),
            ],
            &*crate::storage::STORAGE_ID_ALLOC,
            &mut grid,
        );
    }
    // Verify via get_cell_count (should be at least 3 from YRS cells)
    let count = get_cell_count(storage.doc(), storage.sheets(), &sheet_id);
    assert!(count >= 3);
}

// -----------------------------------------------------------------------
// Test: get_raw_value
// -----------------------------------------------------------------------

#[test]
fn test_get_raw_value_empty() {
    let (storage, mirror, sheet_id) = storage_with_sheet();
    let grid = make_grid_index(sheet_id);
    let raw = get_raw_value(
        &mirror,
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        5,
        5,
        &grid,
    );
    assert_eq!(raw, "");
}

// -----------------------------------------------------------------------
// Test: get_effective_value
// -----------------------------------------------------------------------

#[test]
fn test_get_effective_value_number() {
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        make_cell_id(300),
        0,
        0,
        CellValue::Number(FiniteF64::must(99.0)),
        None,
        None,
    );

    let eff = get_effective_value(&mirror, &sheet_id, 0, 0);
    assert!(eff.is_some());
    assert_eq!(eff.unwrap(), CellValue::Number(FiniteF64::must(99.0)));
}

#[test]
fn test_get_effective_value_empty() {
    let (storage, mirror, sheet_id) = storage_with_sheet();
    let eff = get_effective_value(&mirror, &sheet_id, 5, 5);
    assert!(eff.is_none());
}

// -----------------------------------------------------------------------
// Test: get_cell_count
// -----------------------------------------------------------------------

#[test]
fn test_get_cell_count_empty() {
    let (storage, mirror, sheet_id) = storage_with_sheet();
    assert_eq!(
        get_cell_count(storage.doc(), storage.sheets(), &sheet_id),
        0
    );
}

#[test]
fn test_get_cell_count_with_cells() {
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        make_cell_id(400),
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
        None,
        None,
    );
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        make_cell_id(401),
        0,
        1,
        CellValue::Number(FiniteF64::must(2.0)),
        None,
        None,
    );
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        make_cell_id(402),
        1,
        0,
        CellValue::Text("hello".into()),
        None,
        None,
    );

    assert_eq!(
        get_cell_count(storage.doc(), storage.sheets(), &sheet_id),
        3
    );
}

#[test]
fn test_get_cell_count_nonexistent_sheet() {
    let storage = YrsStorage::new();
    assert_eq!(
        get_cell_count(storage.doc(), storage.sheets(), &make_sheet_id(999)),
        0
    );
}

// -----------------------------------------------------------------------
// Test: import_values
// -----------------------------------------------------------------------

#[test]
fn test_import_values_basic() {
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    let mut grid = make_grid_index(sheet_id);
    {
        let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
        import_values(
            doc,
            sheets,
            mirror,
            &sheet_id,
            &[
                (0, 0, CellValue::Number(FiniteF64::must(42.0)), None),
                (0, 1, CellValue::Text("hello".into()), None),
                (
                    1,
                    0,
                    CellValue::Number(FiniteF64::must(100.0)),
                    Some("A1*2".to_string()),
                ),
            ],
            &*crate::storage::STORAGE_ID_ALLOC,
            &mut grid,
        );
    }
    // Verify cell count
    let count = get_cell_count(storage.doc(), storage.sheets(), &sheet_id);
    assert_eq!(count, 3);
}

// -----------------------------------------------------------------------
// Test: is_plain_number helper
// -----------------------------------------------------------------------

#[test]
fn test_is_plain_number() {
    assert!(is_plain_number("42"));
    assert!(is_plain_number("-42"));
    assert!(is_plain_number("3.14"));
    assert!(is_plain_number("-3.14"));
    assert!(is_plain_number("0"));
    assert!(is_plain_number(".5"));
    assert!(is_plain_number("-.5"));

    assert!(!is_plain_number(""));
    assert!(!is_plain_number("-"));
    assert!(!is_plain_number("abc"));
    assert!(!is_plain_number("42abc"));
    assert!(!is_plain_number("1,234"));
    assert!(!is_plain_number("$42"));
    assert!(!is_plain_number("42."));
}

// -----------------------------------------------------------------------
// Test: Clear on an absent cell is a no-op (does not panic)
// -----------------------------------------------------------------------

#[test]
fn test_clear_absent_cell_is_noop() {
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    let mut grid = make_grid_index(sheet_id);
    {
        let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
        set_cell_value(
            &storage,
            doc,
            sheets,
            mirror,
            &sheet_id,
            0,
            0,
            CellInput::Clear,
            &*crate::storage::STORAGE_ID_ALLOC,
            &mut grid,
        );
    }
}

// -----------------------------------------------------------------------
// Test: Parse(empty) on an absent cell is a no-op
// -----------------------------------------------------------------------

#[test]
fn test_parse_empty_on_absent_cell_is_noop() {
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    let mut grid = make_grid_index(sheet_id);
    {
        let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
        set_cell_value(
            &storage,
            doc,
            sheets,
            mirror,
            &sheet_id,
            0,
            0,
            CellInput::Parse {
                text: String::new(),
            },
            &*crate::storage::STORAGE_ID_ALLOC,
            &mut grid,
        );
    }
}

// -----------------------------------------------------------------------
// Test: integration with parse_input_value for various inputs
// -----------------------------------------------------------------------

#[test]
fn test_parse_input_value_comprehensive() {
    // Numbers
    assert_eq!(parse_input_value("0", None), ParsedValue::Number(0.0));
    assert_eq!(
        parse_input_value("999999", None),
        ParsedValue::Number(999999.0)
    );
    assert_eq!(
        parse_input_value("-1234.5678", None),
        ParsedValue::Number(-1234.5678)
    );

    // Booleans
    assert_eq!(parse_input_value("TRUE", None), ParsedValue::Boolean(true));
    assert_eq!(
        parse_input_value("FALSE", None),
        ParsedValue::Boolean(false)
    );

    // Text
    assert!(matches!(
        parse_input_value("hello world", None),
        ParsedValue::Text(_)
    ));
    assert!(matches!(
        parse_input_value("abc123", None),
        ParsedValue::Text(_)
    ));

    // Empty
    assert_eq!(parse_input_value("", None), ParsedValue::Empty);
}

// -----------------------------------------------------------------------
// sub-scope/A — end-to-end regression tests for CellInput → storage
//
// These pin down the behaviour contract across the typed boundary:
//   CellInput → dispatch_cell_input → yrs+mirror.
// They cover the three intent variants (Clear / Literal / Parse) plus
// the parse sub-cases (empty, formula, numeric, non-ASCII).
// -----------------------------------------------------------------------

/// `CellInput::Clear` removes the cell and leaves no stored value.
#[test]
fn clear_removes_existing_cell() {
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    let mut grid = make_grid_index(sheet_id);

    // Pre-populate a cell so we can verify Clear removes it.
    {
        let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
        set_cell_value(
            &storage,
            doc,
            sheets,
            mirror,
            &sheet_id,
            0,
            0,
            CellInput::Parse {
                text: "42".to_string(),
            },
            &*crate::storage::STORAGE_ID_ALLOC,
            &mut grid,
        );
    }
    assert!(get_effective_value(&mirror, &sheet_id, 0, 0).is_some());

    {
        let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
        set_cell_value(
            &storage,
            doc,
            sheets,
            mirror,
            &sheet_id,
            0,
            0,
            CellInput::Clear,
            &*crate::storage::STORAGE_ID_ALLOC,
            &mut grid,
        );
    }
    assert!(get_effective_value(&mirror, &sheet_id, 0, 0).is_none());
    assert_eq!(
        get_raw_value(
            &mirror,
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            0,
            0,
            &grid,
        ),
        ""
    );
}

/// `Parse("=A1+1")` stores the formula body in yrs; mirror carries Null.
#[test]
fn parse_formula_stores_formula() {
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    let mut grid = make_grid_index(sheet_id);

    {
        let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
        set_cell_value(
            &storage,
            doc,
            sheets,
            mirror,
            &sheet_id,
            0,
            1,
            CellInput::Parse {
                text: "=A1+1".to_string(),
            },
            &*crate::storage::STORAGE_ID_ALLOC,
            &mut grid,
        );
    }

    let val = get_effective_value(&mirror, &sheet_id, 0, 1);
    assert_eq!(val, Some(CellValue::Null));

    let raw = get_raw_value(
        &mirror,
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        0,
        1,
        &grid,
    );
    assert_eq!(raw, "=A1+1");
}

/// `Parse("42")` classifies as number and stores numerically.
#[test]
fn parse_numeric_stores_as_number() {
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    let mut grid = make_grid_index(sheet_id);

    {
        let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
        set_cell_value(
            &storage,
            doc,
            sheets,
            mirror,
            &sheet_id,
            0,
            0,
            CellInput::Parse {
                text: "42".to_string(),
            },
            &*crate::storage::STORAGE_ID_ALLOC,
            &mut grid,
        );
    }
    let val = get_effective_value(&mirror, &sheet_id, 0, 0);
    assert_eq!(val, Some(CellValue::Number(FiniteF64::must(42.0))));
}

/// Forced-text input (apostrophe-prefixed) routes through
/// `CellInput::Literal { text: stripped }` — stripped at the service
/// layer, stored verbatim here. The stored value is the literal text
/// `"42"` (never a number). This pins down the existing product
/// semantics after the sub-scope/A reconcile.
#[test]
fn literal_stores_apostrophe_stripped_text() {
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    let mut grid = make_grid_index(sheet_id);

    let raw = "'42";
    let stored = raw.strip_prefix('\'').unwrap();
    {
        let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
        set_cell_value(
            &storage,
            doc,
            sheets,
            mirror,
            &sheet_id,
            0,
            0,
            CellInput::Literal {
                text: stored.to_string(),
            },
            &*crate::storage::STORAGE_ID_ALLOC,
            &mut grid,
        );
    }
    let val = get_effective_value(&mirror, &sheet_id, 0, 0);
    assert_eq!(val, Some(CellValue::Text("42".into())));
    let raw_view = get_raw_value(
        &mirror,
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        0,
        0,
        &grid,
    );
    assert_eq!(raw_view, "42");
}

/// Non-ASCII input must classify totally (no UTF-8 panic) and round-trip
/// through storage. Borrows from the UTF-8 boundary regression pattern:
/// multi-byte codepoints in both text and formula shapes exercise every
/// `&str` slice on the path.
#[test]
fn parse_non_ascii_no_utf8_panic() {
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    let mut grid = make_grid_index(sheet_id);

    let greek = "Πλήρης";
    {
        let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
        set_cell_value(
            &storage,
            doc,
            sheets,
            mirror,
            &sheet_id,
            0,
            0,
            CellInput::Parse {
                text: greek.to_string(),
            },
            &*crate::storage::STORAGE_ID_ALLOC,
            &mut grid,
        );
    }
    assert_eq!(
        get_effective_value(&mirror, &sheet_id, 0, 0),
        Some(CellValue::Text(greek.into()))
    );

    let greek_formula = "=OFFSET(Π,0,0)";
    {
        let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
        set_cell_value(
            &storage,
            doc,
            sheets,
            mirror,
            &sheet_id,
            1,
            0,
            CellInput::Parse {
                text: greek_formula.to_string(),
            },
            &*crate::storage::STORAGE_ID_ALLOC,
            &mut grid,
        );
    }
    let raw_view = get_raw_value(
        &mirror,
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        1,
        0,
        &grid,
    );
    assert_eq!(raw_view, greek_formula);
}

// -----------------------------------------------------------------------
// Format-aware classifier (G1 percent, G3 fraction)
//
// These tests exercise `parse_input_value(s, target)` with the
// format-category hint. This path implements the G1
// (percent ÷100 on bare numbers) and G3 (fraction "n/d" → f64)
// transforms, backed by regression tests for the parser behavior.
// -----------------------------------------------------------------------

/// G1: bare number into a percent-formatted cell divides by 100.
#[test]
fn parse_input_value_percent_hint_bare_number() {
    match parse_input_value("11", Some(FormatType::Percentage)) {
        ParsedValue::Number(n) => assert!((n - 0.11).abs() < 1e-12, "got {n}"),
        other => panic!("expected Number(0.11), got {other:?}"),
    }
}

/// G1: negative bare number into a percent cell.
#[test]
fn parse_input_value_percent_hint_negative_bare_number() {
    match parse_input_value("-5", Some(FormatType::Percentage)) {
        ParsedValue::Number(n) => assert!((n - -0.05).abs() < 1e-12, "got {n}"),
        other => panic!("expected Number(-0.05), got {other:?}"),
    }
}

/// G1 regression guard: input shape already has `%` — `parse_formatted_number`
/// divides; the hint must NOT double-divide.
#[test]
fn parse_input_value_percent_hint_input_with_percent_does_not_double_divide() {
    match parse_input_value("50%", Some(FormatType::Percentage)) {
        ParsedValue::Number(n) => assert!((n - 0.5).abs() < 1e-12, "got {n}"),
        other => panic!("expected Number(0.5), got {other:?}"),
    }
}

/// Invariant: date-shaped input into an explicit non-date
/// format (here Percentage) falls through to text rather than coercing
/// to a date serial the format would misrender. Excel parity:
/// "format-aware text fallback." Pairs with the Phase-1 stickiness
/// guard in the engine — the cell keeps its Percentage format AND the
/// value is text, not a serial under the wrong format.
#[test]
fn parse_input_value_percent_hint_date_input_falls_through_to_text() {
    match parse_input_value("3/14/2024", Some(FormatType::Percentage)) {
        ParsedValue::Text(s) => assert_eq!(s, "3/14/2024"),
        other => panic!("expected Text(\"3/14/2024\"), got {other:?}"),
    }
}

/// G1 regression guard: `"$100"` into a percent cell stays `Number(100)`.
/// Currency-prefix path classifies via `parse_formatted_number`; hint
/// must NOT divide.
#[test]
fn parse_input_value_percent_hint_currency_prefix_stays_unchanged() {
    match parse_input_value("$100", Some(FormatType::Percentage)) {
        ParsedValue::Number(n) => assert!((n - 100.0).abs() < 1e-12, "got {n}"),
        other => panic!("expected Number(100), got {other:?}"),
    }
}

/// G1 regression guard: format-blind path unchanged for bare number.
#[test]
fn parse_input_value_no_hint_bare_number_unchanged() {
    assert_eq!(parse_input_value("11", None), ParsedValue::Number(11.0));
}

/// G3: bare "1/2" into a fraction-formatted cell parses as 0.5.
#[test]
fn parse_input_value_fraction_hint_bare_fraction() {
    match parse_input_value("1/2", Some(FormatType::Fraction)) {
        ParsedValue::Number(n) => assert!((n - 0.5).abs() < 1e-12, "got {n}"),
        other => panic!("expected Number(0.5), got {other:?}"),
    }
}

/// Format-blind path uses the culture-aware date parser. Two-part slash
/// dates use the parser's explicit default year (2000), so `"1/2"` is
/// January 2, 2000 rather than a fraction.
#[test]
fn parse_input_value_no_hint_slash_date_uses_default_year() {
    match parse_input_value("1/2", None) {
        ParsedValue::Number(n) => assert!((n - 36527.0).abs() < 1e-9, "got {n}"),
        other => panic!("expected Number(36527), got {other:?}"),
    }
}

// ── Date-branch hint awareness ─────────────────────────────────────
//
// An explicit non-date target format suppresses date-shape coercion so
// the input falls through to text rather than landing as a serial under
// a format that will misrender it ("format-aware text fallback," Excel
// parity). General/None/Date/Time/Custom remain permissive.
/// `"3/15/2024"` into a Fraction-formatted cell is text — the
/// fraction parser fails on this shape and we no longer fall back to
/// the date branch.
#[test]
fn parse_input_value_fraction_hint_date_shaped_falls_through_to_text() {
    match parse_input_value("3/15/2024", Some(FormatType::Fraction)) {
        ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
        other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
    }
}

/// Phase-2: Number-formatted cell rejects date-shaped input.
#[test]
fn parse_input_value_number_hint_date_shaped_falls_through_to_text() {
    match parse_input_value("3/15/2024", Some(FormatType::Number)) {
        ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
        other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
    }
}

/// Phase-2: Currency-formatted cell rejects date-shaped input.
#[test]
fn parse_input_value_currency_hint_date_shaped_falls_through_to_text() {
    match parse_input_value("3/15/2024", Some(FormatType::Currency)) {
        ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
        other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
    }
}

/// Phase-2: Accounting-formatted cell rejects date-shaped input.
#[test]
fn parse_input_value_accounting_hint_date_shaped_falls_through_to_text() {
    match parse_input_value("3/15/2024", Some(FormatType::Accounting)) {
        ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
        other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
    }
}

/// Phase-2: Percentage-formatted cell rejects date-shaped input. Pairs
/// with `parse_input_value_percent_hint_date_input_falls_through_to_text`
/// which uses the older `"3/14/2024"` literal — keep both for breadth.
#[test]
fn parse_input_value_percentage_hint_date_shaped_falls_through_to_text() {
    match parse_input_value("3/15/2024", Some(FormatType::Percentage)) {
        ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
        other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
    }
}

/// Phase-2: Scientific-formatted cell rejects date-shaped input.
#[test]
fn parse_input_value_scientific_hint_date_shaped_falls_through_to_text() {
    match parse_input_value("3/15/2024", Some(FormatType::Scientific)) {
        ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
        other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
    }
}

/// Phase-2: Special-formatted cell (ZIP/Phone/SSN) rejects date-shaped
/// input — like other non-date explicit formats, the user told us what
/// shape this cell holds.
#[test]
fn parse_input_value_special_hint_date_shaped_falls_through_to_text() {
    match parse_input_value("3/15/2024", Some(FormatType::Special)) {
        ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
        other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
    }
}

/// Phase-2 negative control: `None` hint keeps the historical
/// permissive behavior — date-shaped input lands as a serial.
#[test]
fn parse_input_value_no_hint_date_shaped_still_serial() {
    match parse_input_value("3/15/2024", None) {
        ParsedValue::Number(n) => {
            // 3/15/2024 → Excel serial 45366 on 1900 epoch.
            assert!((n - 45366.0).abs() < 1e-9, "got {n}");
        }
        other => panic!("expected Number(serial), got {other:?}"),
    }
}

/// Phase-2 negative control: `General` hint keeps the historical
/// permissive behavior. Pairs with the engine-side auto-inference
/// regression guard: General cells get an inferred date format
/// applied after the parse.
#[test]
fn parse_input_value_general_hint_date_shaped_still_serial() {
    match parse_input_value("3/15/2024", Some(FormatType::General)) {
        ParsedValue::Number(n) => {
            assert!((n - 45366.0).abs() < 1e-9, "got {n}");
        }
        other => panic!("expected Number(serial), got {other:?}"),
    }
}

/// Phase-2 negative control: Date hint of course still parses as a
/// serial — that's the format-matched case the date branch is for.
#[test]
fn parse_input_value_date_hint_date_shaped_still_serial() {
    match parse_input_value("3/15/2024", Some(FormatType::Date)) {
        ParsedValue::Number(n) => {
            assert!((n - 45366.0).abs() < 1e-9, "got {n}");
        }
        other => panic!("expected Number(serial), got {other:?}"),
    }
}

/// Phase-2 negative control: `Custom` stays permissive on the date
/// branch — by definition we don't know what a custom format expects.
/// Phase-1 stickiness still keeps the format string intact.
#[test]
fn parse_input_value_custom_hint_date_shaped_still_serial() {
    match parse_input_value("3/15/2024", Some(FormatType::Custom)) {
        ParsedValue::Number(n) => {
            assert!((n - 45366.0).abs() < 1e-9, "got {n}");
        }
        other => panic!("expected Number(serial), got {other:?}"),
    }
}

/// Phase-2 negative control: Time hint stays permissive — time and
/// date share the serial space, so date-shaped input under a Time
/// format still parses to the serial (the user can have a time-of-
/// day-only formatted cell that nonetheless contains a full
/// date-time value).
#[test]
fn parse_input_value_time_hint_date_shaped_still_serial() {
    match parse_input_value("3/15/2024", Some(FormatType::Time)) {
        ParsedValue::Number(n) => {
            assert!((n - 45366.0).abs() < 1e-9, "got {n}");
        }
        other => panic!("expected Number(serial), got {other:?}"),
    }
}
