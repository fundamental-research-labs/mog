//! Groups 16, 18: Row/col/cell formats, displayed properties, CF overlay.

use super::super::*;
use super::helpers::*;
use value_types::CellValue;

// -------------------------------------------------------------------
// Bulk Row/Col/Cell Property Endpoint Tests
// -------------------------------------------------------------------

#[test]
fn test_get_row_formats_empty() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // No row formats have been set, so all should be None
    let result = engine.get_row_formats(&sid, vec![0, 1, 2]);
    assert_eq!(result.len(), 3);
    for (row, fmt) in &result {
        assert!(fmt.is_none(), "Row {} should have no format", row);
    }
}

#[test]
fn test_set_and_get_row_formats() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let bold_fmt = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    let italic_fmt = CellFormat {
        italic: Some(true),
        ..Default::default()
    };

    // Set formats for rows 0 and 2
    let result = engine.set_row_formats(&sid, vec![(0, bold_fmt.clone()), (2, italic_fmt.clone())]);
    assert!(result.is_ok());

    // Read them back
    let formats = engine.get_row_formats(&sid, vec![0, 1, 2]);
    assert_eq!(formats.len(), 3);

    // Row 0 should be bold
    assert!(formats[0].1.is_some());
    assert_eq!(formats[0].1.as_ref().unwrap().bold, Some(true));

    // Row 1 should be empty
    assert!(formats[1].1.is_none());

    // Row 2 should be italic
    assert!(formats[2].1.is_some());
    assert_eq!(formats[2].1.as_ref().unwrap().italic, Some(true));
}

#[test]
fn test_get_col_formats_empty() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let result = engine.get_col_formats(&sid, vec![0, 1, 5]);
    assert_eq!(result.len(), 3);
    for (col, fmt) in &result {
        assert!(fmt.is_none(), "Col {} should have no format", col);
    }
}

#[test]
fn test_set_and_get_col_formats() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let bold_fmt = CellFormat {
        bold: Some(true),
        ..Default::default()
    };

    // Set format for column 1
    let result = engine.set_col_formats(&sid, vec![(1, bold_fmt.clone())]);
    assert!(result.is_ok());

    // Read back
    let formats = engine.get_col_formats(&sid, vec![0, 1]);
    assert_eq!(formats.len(), 2);

    // Col 0 should be empty
    assert!(formats[0].1.is_none());

    // Col 1 should be bold
    assert!(formats[1].1.is_some());
    assert_eq!(formats[1].1.as_ref().unwrap().bold, Some(true));
}

#[test]
fn test_query_range_properties_basic() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Set a format on cell A1 via set_format_for_ranges
    let bold_fmt = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &bold_fmt)
        .unwrap();

    // Query the 2x2 range A1:B2
    let result = engine.query_range_properties(&sid, 0, 0, 1, 1);
    assert!(result.is_ok());
    let grid = result.unwrap();
    assert_eq!(grid.len(), 2); // 2 rows
    assert_eq!(grid[0].len(), 2); // 2 cols

    // A1 should have bold=true (effective format includes cell-level bold)
    let a1_fmt = grid[0][0].as_ref().expect("A1 should have a format");
    assert_eq!(a1_fmt.bold, Some(true));
}

#[test]
fn test_query_range_properties_too_large() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // 101 x 100 = 10100 > 10000 limit
    let result = engine.query_range_properties(&sid, 0, 0, 100, 99);
    assert!(result.is_err());
    let err_msg = format!("{:?}", result.unwrap_err());
    assert!(
        err_msg.contains("too large"),
        "Error should mention size limit: {}",
        err_msg
    );
}

#[test]
fn test_query_range_properties_within_limit() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // 100 x 100 = 10000 exactly at the limit -- should succeed
    let result = engine.query_range_properties(&sid, 0, 0, 99, 99);
    assert!(result.is_ok());
    let grid = result.unwrap();
    assert_eq!(grid.len(), 100);
    assert_eq!(grid[0].len(), 100);
}

#[test]
fn test_set_cell_properties_batch() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let bold_fmt = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    let italic_fmt = CellFormat {
        italic: Some(true),
        ..Default::default()
    };

    // Set different formats for different cells
    let result = engine.set_cell_properties_batch(
        &sid,
        vec![
            (0, 0, bold_fmt.clone()),   // A1 bold
            (1, 1, italic_fmt.clone()), // B2 italic
        ],
    );
    assert!(result.is_ok());

    // Verify via query_range_properties
    let grid = engine.query_range_properties(&sid, 0, 0, 1, 1).unwrap();

    // A1 should have bold
    let a1 = grid[0][0].as_ref().expect("A1 should have a format");
    assert_eq!(a1.bold, Some(true));

    // B2 should have italic
    let b2 = grid[1][1].as_ref().expect("B2 should have a format");
    assert_eq!(b2.italic, Some(true));
}

#[test]
fn test_set_cell_properties_batch_sheet_not_found() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let bad_sid = SheetId::from_uuid_str("00000000-0000-0000-0000-000000000099").unwrap();

    let fmt = CellFormat {
        bold: Some(true),
        ..Default::default()
    };

    let result = engine.set_cell_properties_batch(&bad_sid, vec![(0, 0, fmt)]);
    assert!(result.is_err());
}

#[test]
fn test_row_col_formats_interact_with_cell_effective_format() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Set row 0 to bold
    engine
        .set_row_formats(
            &sid,
            vec![(
                0,
                CellFormat {
                    bold: Some(true),
                    ..Default::default()
                },
            )],
        )
        .unwrap();

    // Set col 0 to italic
    engine
        .set_col_formats(
            &sid,
            vec![(
                0,
                CellFormat {
                    italic: Some(true),
                    ..Default::default()
                },
            )],
        )
        .unwrap();

    // Query A1 -- should inherit both bold (from row) and italic (from col)
    let grid = engine.query_range_properties(&sid, 0, 0, 0, 0).unwrap();
    let a1 = grid[0][0].as_ref().expect("A1 should have format");
    assert_eq!(a1.bold, Some(true), "A1 should inherit bold from row 0");
    assert_eq!(a1.italic, Some(true), "A1 should inherit italic from col 0");
}

// -------------------------------------------------------------------
// get_displayed_cell_properties tests
// -------------------------------------------------------------------

#[test]
fn test_get_displayed_cell_properties_basic() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Set bold on A1
    let bold_fmt = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &bold_fmt)
        .unwrap();

    // get_displayed_cell_properties should return the effective format (includes bold)
    let displayed = engine.get_displayed_cell_properties(&sid, 0, 0);
    assert_eq!(displayed.bold, Some(true), "A1 should show bold=true");
}

#[test]
fn test_get_displayed_cell_properties_with_cf() {
    use compute_cf::types::CellCFResult;
    use compute_cf::types::CfRenderStyle as CFStyle;
    use domain_types::CellFormat;
    use value_types::Color;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Set bold on A1 (cell-level format)
    let bold_fmt = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &bold_fmt)
        .unwrap();

    // Manually populate CF cache with a result for A1:
    // CF says italic=true and background_color=red
    let mut cf_results = rustc_hash::FxHashMap::default();
    cf_results.insert(
        (0u32, 0u32),
        CellCFResult {
            row: 0,
            col: 0,
            style: Some(CFStyle {
                italic: Some(true),
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            ..Default::default()
        },
    );
    engine.stores.cf_cache.insert(
        sid,
        super::super::stores::CFCacheEntry {
            results: cf_results,
            dirty: false,
        },
    );

    let displayed = engine.get_displayed_cell_properties(&sid, 0, 0);

    // Bold from cell format
    assert_eq!(
        displayed.bold,
        Some(true),
        "Bold should come from cell format"
    );
    // Italic from CF
    assert_eq!(displayed.italic, Some(true), "Italic should come from CF");
    // Background color from CF (Color.to_string() -> "#rrggbb" lowercase)
    assert_eq!(
        displayed.background_color,
        Some("#ff0000".to_string()),
        "Background color should come from CF"
    );
}

#[test]
fn test_get_displayed_cell_properties_cf_overrides_cell() {
    use compute_cf::types::CellCFResult;
    use compute_cf::types::CfRenderStyle as CFStyle;
    use domain_types::CellFormat;
    use value_types::Color;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Set background_color on A1 (cell-level)
    let cell_fmt = CellFormat {
        background_color: Some("#0000FF".to_string()),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &cell_fmt)
        .unwrap();

    // CF says background_color=red (should override cell blue)
    let mut cf_results = rustc_hash::FxHashMap::default();
    cf_results.insert(
        (0u32, 0u32),
        CellCFResult {
            row: 0,
            col: 0,
            style: Some(CFStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            ..Default::default()
        },
    );
    engine.stores.cf_cache.insert(
        sid,
        super::super::stores::CFCacheEntry {
            results: cf_results,
            dirty: false,
        },
    );

    let displayed = engine.get_displayed_cell_properties(&sid, 0, 0);

    // CF background should override cell background
    assert_eq!(
        displayed.background_color,
        Some("#ff0000".to_string()),
        "CF background should override cell-level background"
    );
}

#[test]
fn test_get_displayed_cell_properties_empty_cell() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Query a cell with no data and no format (e.g., Z99)
    let displayed = engine.get_displayed_cell_properties(&sid, 98, 25);

    // Should return the default format (all None except defaults)
    // No crash, no error
    assert_eq!(
        displayed.bold,
        Some(false),
        "Empty cell should have default bold=false"
    );
    assert_eq!(
        displayed.italic,
        Some(false),
        "Empty cell should have default italic=false"
    );
}

// CF is a *range-scoped* cascade layer, not a per-cell-format layer: a rule
// like `containsBlanks` evaluates positively on cells that have no CellId at
// all. The cf_cache is keyed by `(row, col)` so the result is present, and
// the displayed-properties bridge must surface it regardless of CellId
// allocation. Regression for `cf-blanks` app-eval scenario.
#[test]
fn test_get_displayed_cell_properties_with_cf_on_truly_blank_cell() {
    use compute_cf::types::CellCFResult;
    use compute_cf::types::CfRenderStyle as CFStyle;
    use value_types::Color;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // (5,5) has no value, no formula, no cell-level format -> no CellId.
    let mut cf_results = rustc_hash::FxHashMap::default();
    cf_results.insert(
        (5u32, 5u32),
        CellCFResult {
            row: 5,
            col: 5,
            style: Some(CFStyle {
                background_color: Some(Color::from_hex("#FFA500").unwrap()),
                ..Default::default()
            }),
            ..Default::default()
        },
    );
    engine.stores.cf_cache.insert(
        sid,
        super::super::stores::CFCacheEntry {
            results: cf_results,
            dirty: false,
        },
    );

    let displayed = engine.get_displayed_cell_properties(&sid, 5, 5);

    assert_eq!(
        displayed.background_color,
        Some("#ffa500".to_string()),
        "containsBlanks-style CF must paint cells without a CellId"
    );
}

// -------------------------------------------------------------------
// get_displayed_range_properties tests
// -------------------------------------------------------------------

#[test]
fn test_get_displayed_range_properties_basic() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Set bold on A1
    let bold_fmt = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &bold_fmt)
        .unwrap();

    // Query 2x2 range A1:B2
    let result = engine.get_displayed_range_properties(&sid, 0, 0, 1, 1);
    assert!(result.is_ok());
    let grid = result.unwrap();
    assert_eq!(grid.len(), 2, "Should have 2 rows");
    assert_eq!(grid[0].len(), 2, "Should have 2 cols");

    // A1 should have bold
    assert_eq!(grid[0][0].bold, Some(true), "A1 should have bold");
}

#[test]
fn test_get_displayed_range_properties_too_large() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // 101 x 100 = 10100 > 10000 limit
    let result = engine.get_displayed_range_properties(&sid, 0, 0, 100, 99);
    assert!(result.is_err());
    let err_msg = format!("{:?}", result.unwrap_err());
    assert!(
        err_msg.contains("too large"),
        "Error should mention size limit: {}",
        err_msg
    );
}

#[test]
fn test_get_displayed_range_properties_with_cf() {
    use compute_cf::types::CellCFResult;
    use compute_cf::types::CfRenderStyle as CFStyle;
    use domain_types::CellFormat;
    use value_types::Color;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Set bold on A1
    let bold_fmt = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &bold_fmt)
        .unwrap();

    // CF: A1 gets italic=true, B1 gets background=green
    let mut cf_results = rustc_hash::FxHashMap::default();
    cf_results.insert(
        (0u32, 0u32),
        CellCFResult {
            row: 0,
            col: 0,
            style: Some(CFStyle {
                italic: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        },
    );
    cf_results.insert(
        (0u32, 1u32),
        CellCFResult {
            row: 0,
            col: 1,
            style: Some(CFStyle {
                background_color: Some(Color::from_hex("#00FF00").unwrap()),
                ..Default::default()
            }),
            ..Default::default()
        },
    );
    engine.stores.cf_cache.insert(
        sid,
        super::super::stores::CFCacheEntry {
            results: cf_results,
            dirty: false,
        },
    );

    let result = engine.get_displayed_range_properties(&sid, 0, 0, 0, 1);
    assert!(result.is_ok());
    let grid = result.unwrap();

    // A1: bold from cell, italic from CF
    assert_eq!(grid[0][0].bold, Some(true), "A1 bold from cell format");
    assert_eq!(grid[0][0].italic, Some(true), "A1 italic from CF");

    // B1: background from CF
    assert_eq!(
        grid[0][1].background_color,
        Some("#00ff00".to_string()),
        "B1 background from CF"
    );
}

// Range-flavored mirror of test_get_displayed_cell_properties_with_cf_on_truly_blank_cell:
// a `containsBlanks` rule's painted cells must surface in the batch
// (`getDisplayedRangeProperties`) read path that the harness's
// `readDisplayedFormatsViaBridge` prefers. Regression for `cf-blanks`.
#[test]
fn test_get_displayed_range_properties_with_cf_on_truly_blank_cells() {
    use compute_cf::types::CellCFResult;
    use compute_cf::types::CfRenderStyle as CFStyle;
    use value_types::Color;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // CF rule conceptually applied to A6:A10 (range with NO existing cells).
    // Pretend the evaluator already populated the cache for these positions
    // (in production, the scheduler iterates the rule's range positions and
    // evaluates each, including blank-valued cells).
    let mut cf_results = rustc_hash::FxHashMap::default();
    for row in 5u32..=9 {
        cf_results.insert(
            (row, 0u32),
            CellCFResult {
                row,
                col: 0,
                style: Some(CFStyle {
                    background_color: Some(Color::from_hex("#FFA500").unwrap()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        );
    }
    engine.stores.cf_cache.insert(
        sid,
        super::super::stores::CFCacheEntry {
            results: cf_results,
            dirty: false,
        },
    );

    let result = engine.get_displayed_range_properties(&sid, 5, 0, 9, 0);
    assert!(result.is_ok());
    let grid = result.unwrap();
    assert_eq!(grid.len(), 5, "five rows, A6..A10");

    for (i, row_fmts) in grid.iter().enumerate() {
        assert_eq!(row_fmts.len(), 1);
        assert_eq!(
            row_fmts[0].background_color,
            Some("#ffa500".to_string()),
            "A{} (truly blank) must show the CF backgroundColor",
            i + 6
        );
    }
}

// -------------------------------------------------------------------
// Format-aware input — format-aware input parser end-to-end
// -------------------------------------------------------------------

/// G1 end-to-end: pre-format A1 percent, then `set_cell_value_parsed("11")`.
/// The mirror's value (and yrs storage) must hold `0.11`, not `11`.
#[test]
fn format_aware_input_percent_e2e() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let percent_fmt = CellFormat {
        number_format: Some("0%".to_string()),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &percent_fmt)
        .unwrap();

    engine.set_cell_value_parsed(&sid, 0, 0, "11").unwrap();

    let val = engine.get_cell_value(&sid, 0, 0);
    match val {
        CellValue::Number(n) => assert!(
            (*n - 0.11).abs() < 1e-12,
            "expected 0.11, got {} — G1 percent hint did not apply",
            *n
        ),
        other => panic!("expected Number(0.11), got {:?}", other),
    }
}
