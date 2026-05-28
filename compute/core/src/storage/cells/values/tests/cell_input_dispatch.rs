use super::support::{make_grid_index, storage_with_sheet};
use super::*;

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

// G1: bare number into a percent-formatted cell divides by 100.
