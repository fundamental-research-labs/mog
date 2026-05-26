//! Viewport buffer filter tests.
//!
//! These exercise the real `compute_security::SheetAccessMatrix` constructed
//! via `PolicyEngine::evaluate_sheet`, so the filter is tested against
//! matrices shaped the way production produces them — not stub constructors.

use std::sync::Arc;

use cell_types::{ColId, SheetId};
use compute_security::{
    AccessLevel, AccessPolicy, AccessTarget, ColumnIndex, PolicyEngine, PolicyId, PolicyMetadata,
    PrincipalPool, PrincipalTag, SheetAccessMatrix, TagMatcher,
};
use compute_wire::constants::{
    CELL_STRIDE, NO_STRING, OFF_DISPLAY_OFF, OFF_ERROR_OFF, OFF_FLAGS, VIEWPORT_HEADER_SIZE,
};
use compute_wire::deserialize::{DeserializedCell, deserialize_viewport};
use compute_wire::flags;
use compute_wire::types::{
    RenderColDimension, RenderRowDimension, RenderViewportMerge, ViewportRenderCell,
    ViewportRenderData,
};
use compute_wire::{filter_viewport_buffer, serialize_viewport_binary};

// ---------------------------------------------------------------------------
// Test-helpers: build SheetAccessMatrix via PolicyEngine::evaluate_sheet.
//
// The matrix in compute-security is the output of the policy resolver — not a
// user-authored type. We construct matrices the same way production code does
// (one PolicyEngine + one Principal + one ColumnIndex), using just enough
// policies to shape the matrix we want.
// ---------------------------------------------------------------------------

fn test_sheet() -> SheetId {
    SheetId::from_raw(0x1111_1111_1111_1111_1111_1111_1111_1111)
}

fn col_id(i: u32) -> ColId {
    // Deterministic col IDs keyed on position so StubIndex can resolve them.
    ColId::from_raw(0x1000_0000_0000_0000_0000_0000_0000_0000 | u128::from(i))
}

fn make_policy(
    principal_tag: &str,
    target: AccessTarget,
    level: AccessLevel,
    priority: i32,
) -> AccessPolicy {
    AccessPolicy {
        id: PolicyId::new_v4(),
        principal_tag: TagMatcher::parse(principal_tag),
        target,
        level,
        priority,
        enabled: true,
        metadata: PolicyMetadata {
            created_by: Arc::from("test"),
            created_at_millis: 0,
            template_id: None,
        },
    }
}

fn principal_with(tags: &[&str]) -> compute_security::Principal {
    let pool = PrincipalPool::new();
    pool.intern(tags.iter().map(|t| PrincipalTag::from(*t)))
}

struct StubIndex {
    count: u32,
}

impl ColumnIndex for StubIndex {
    fn position_of(&self, col: ColId) -> Option<u32> {
        // col_id(i) encodes `i` in the low bits of the u128 tag.
        let raw = col.as_u128();
        let masked = raw & 0x0FFF_FFFF_FFFF_FFFF_FFFF_FFFF_FFFF_FFFF;
        let pos = u32::try_from(masked).ok()?;
        if pos < self.count { Some(pos) } else { None }
    }
    fn column_count(&self) -> u32 {
        self.count
    }
}

/// Uniform matrix via a single workbook-level policy hitting the principal,
/// with *no* column policies. `evaluate_sheet` returns a matrix whose
/// `sheet_default = level` and no overrides — `is_uniform() == Some(level)`.
fn uniform_matrix(level: AccessLevel, column_count: u32) -> SheetAccessMatrix {
    let principal = principal_with(&["agent:copilot"]);
    let engine = if level == AccessLevel::None {
        // Default for non-owner with no policies is None — empty engine.
        PolicyEngine::new(Vec::<AccessPolicy>::new())
    } else {
        PolicyEngine::new([make_policy("agent:*", AccessTarget::Workbook, level, 0)])
    };
    engine.evaluate_sheet(
        &principal,
        test_sheet(),
        &StubIndex {
            count: column_count,
        },
    )
}

/// Build a matrix with `default` as sheet default and per-column overrides.
/// For each override that differs from `default`, a dedicated column policy
/// is emitted; the resolver then bakes it into the matrix.
fn per_column_matrix(default: AccessLevel, overrides: &[AccessLevel]) -> SheetAccessMatrix {
    let principal = principal_with(&["agent:copilot"]);
    let mut policies: Vec<AccessPolicy> = Vec::new();

    // Sheet default via a workbook-level policy (skip if default is None —
    // empty policy set + non-owner principal already yields None).
    if default != AccessLevel::None {
        policies.push(make_policy("agent:*", AccessTarget::Workbook, default, 0));
    }

    for (i, &level) in overrides.iter().enumerate() {
        if level == default {
            continue;
        }
        policies.push(make_policy(
            "agent:*",
            AccessTarget::Column {
                sheet_id: test_sheet(),
                col_id: col_id(i as u32),
            },
            level,
            10, // higher priority than the sheet default
        ));
    }

    let engine = PolicyEngine::new(policies);
    engine.evaluate_sheet(
        &principal,
        test_sheet(),
        &StubIndex {
            count: overrides.len() as u32,
        },
    )
}

// ---------------------------------------------------------------------------
// Fixture builders.
// ---------------------------------------------------------------------------

/// Build a 2×2 viewport with one cell of each value type.
fn build_mixed_viewport() -> ViewportRenderData {
    use domain_types::CellFormat;
    ViewportRenderData {
        cells: vec![
            ViewportRenderCell {
                row: 0,
                col: 0,
                format_idx: 0,
                flags: flags::VALUE_TYPE_NUMBER,
                number_value: 42.0,
                formatted: Some("42".to_string()),
                error: None,
                bg_color_override: 0x1122_3344,
                font_color_override: 0x5566_7788,
                cf_extras: None,
            },
            ViewportRenderCell {
                row: 0,
                col: 1,
                format_idx: 0,
                flags: flags::VALUE_TYPE_TEXT,
                number_value: f64::NAN,
                formatted: Some("hello".to_string()),
                error: None,
                bg_color_override: 0,
                font_color_override: 0,
                cf_extras: None,
            },
            ViewportRenderCell {
                row: 1,
                col: 0,
                format_idx: 0,
                flags: flags::VALUE_TYPE_BOOL,
                number_value: 1.0,
                formatted: Some("TRUE".to_string()),
                error: None,
                bg_color_override: 0,
                font_color_override: 0,
                cf_extras: None,
            },
            ViewportRenderCell {
                row: 1,
                col: 1,
                format_idx: 0,
                flags: flags::VALUE_TYPE_ERROR,
                number_value: f64::NAN,
                formatted: None,
                error: Some("#DIV/0!".to_string()),
                bg_color_override: 0,
                font_color_override: 0,
                cf_extras: None,
            },
        ],
        format_palette: vec![CellFormat::default()],
        merges: vec![RenderViewportMerge {
            start_row: 0,
            start_col: 0,
            end_row: 0,
            end_col: 0,
        }],
        row_dimensions: vec![RenderRowDimension {
            row: 0,
            height: 20.0,
            hidden: false,
        }],
        col_dimensions: vec![RenderColDimension {
            col: 0,
            width: 80.0,
            hidden: false,
        }],
        viewport_rows: 2,
        viewport_cols: 2,
        start_row: 0,
        start_col: 0,
        // Length = viewport_{rows,cols} + 1 (2 entries + 1 sentinel).
        row_positions: vec![0.0, 20.0, 40.0],
        col_positions: vec![0.0, 80.0, 160.0],
    }
}

fn build_single_number_viewport() -> ViewportRenderData {
    use domain_types::CellFormat;
    ViewportRenderData {
        cells: vec![ViewportRenderCell {
            row: 0,
            col: 0,
            format_idx: 0,
            flags: flags::VALUE_TYPE_NUMBER,
            number_value: 7.0,
            formatted: Some("7".to_string()),
            error: None,
            bg_color_override: 0,
            font_color_override: 0,
            cf_extras: None,
        }],
        format_palette: vec![CellFormat::default()],
        merges: Vec::new(),
        row_dimensions: Vec::new(),
        col_dimensions: Vec::new(),
        viewport_rows: 1,
        viewport_cols: 1,
        start_row: 0,
        start_col: 0,
        // Deserializer requires len(row_positions) == viewport_rows + 1
        // (1 in-range entry + 1 trailing sentinel).
        row_positions: vec![0.0, 21.0],
        col_positions: vec![0.0, 64.0],
    }
}

fn build_empty_viewport() -> ViewportRenderData {
    ViewportRenderData {
        cells: Vec::new(),
        format_palette: Vec::new(),
        merges: Vec::new(),
        row_dimensions: Vec::new(),
        col_dimensions: Vec::new(),
        viewport_rows: 0,
        viewport_cols: 0,
        start_row: 0,
        start_col: 0,
        row_positions: Vec::new(),
        col_positions: Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// 1. Uniform None → all values zeroed.
// ---------------------------------------------------------------------------

#[test]
fn uniform_none_zeros_all_values() {
    let data = build_mixed_viewport();
    let mut buf = serialize_viewport_binary(&data, 0, false, 0);
    let original_len = buf.len();
    let matrix = uniform_matrix(AccessLevel::None, 2);
    assert_eq!(matrix.is_uniform(), Some(AccessLevel::None));

    filter_viewport_buffer(&mut buf, &matrix);

    // No shift: uniform None doesn't touch the string pool.
    assert_eq!(
        buf.len(),
        original_len,
        "uniform None must not extend the buffer"
    );

    // All cell records should have number_value=0, display_off=NO_STRING,
    // value-type bits cleared.
    for i in 0..data.cells.len() {
        let base = VIEWPORT_HEADER_SIZE + i * CELL_STRIDE;
        let num = f64::from_le_bytes(buf[base..base + 8].try_into().unwrap());
        assert_eq!(num, 0.0, "cell {i} number_value must be zero");
        let display_off = u32::from_le_bytes(
            buf[base + OFF_DISPLAY_OFF..base + OFF_DISPLAY_OFF + 4]
                .try_into()
                .unwrap(),
        );
        assert_eq!(
            display_off, NO_STRING,
            "cell {i} display_off must be NO_STRING"
        );
        let error_off = u32::from_le_bytes(
            buf[base + OFF_ERROR_OFF..base + OFF_ERROR_OFF + 4]
                .try_into()
                .unwrap(),
        );
        assert_eq!(error_off, NO_STRING, "cell {i} error_off must be NO_STRING");
        let flags_u16 = u16::from_le_bytes(
            buf[base + OFF_FLAGS..base + OFF_FLAGS + 2]
                .try_into()
                .unwrap(),
        );
        assert_eq!(
            flags_u16 & flags::VALUE_TYPE_MASK,
            flags::VALUE_TYPE_NULL,
            "cell {i} value-type bits must be cleared"
        );
    }
}

// ---------------------------------------------------------------------------
// 2. Uniform Structure → type placeholder per cell.
// ---------------------------------------------------------------------------

#[test]
fn uniform_structure_replaces_values_with_type_placeholders() {
    let data = build_mixed_viewport();
    let mut buf = serialize_viewport_binary(&data, 0, false, 0);
    let matrix = uniform_matrix(AccessLevel::Structure, 2);
    assert_eq!(matrix.is_uniform(), Some(AccessLevel::Structure));

    filter_viewport_buffer(&mut buf, &matrix);

    // Buffer must still be parseable end-to-end (all section offsets moved
    // forward by the placeholder bytes).
    let view = deserialize_viewport(&buf).expect("filtered buffer must round-trip");
    assert_eq!(view.cells.len(), 4);

    // Value-type bits preserved so the renderer knows the shape.
    assert_type_bits(&view.cells[0], flags::VALUE_TYPE_NUMBER);
    assert_type_bits(&view.cells[1], flags::VALUE_TYPE_TEXT);
    assert_type_bits(&view.cells[2], flags::VALUE_TYPE_BOOL);
    assert_type_bits(&view.cells[3], flags::VALUE_TYPE_ERROR);

    // number_value zeroed, error string cleared.
    for (i, cell) in view.cells.iter().enumerate() {
        assert_eq!(
            cell.number_value, 0.0,
            "cell {i}: number_value must be zeroed, got {}",
            cell.number_value
        );
        assert!(cell.error.is_none(), "cell {i}: error must be cleared");
    }

    // Placeholder characters per type.
    assert_eq!(view.cells[0].display.as_deref(), Some("#"));
    assert_eq!(view.cells[1].display.as_deref(), Some("-"));
    assert_eq!(view.cells[2].display.as_deref(), Some("?"));
    assert_eq!(view.cells[3].display.as_deref(), Some("!"));
}

fn assert_type_bits(cell: &DeserializedCell, expected: u16) {
    assert_eq!(
        cell.flags & flags::VALUE_TYPE_MASK,
        expected,
        "value-type bits drifted"
    );
}

// ---------------------------------------------------------------------------
// 3. Uniform Read / Write / Admin → passthrough.
// ---------------------------------------------------------------------------

#[test]
fn uniform_read_is_passthrough() {
    let data = build_mixed_viewport();
    let mut buf = serialize_viewport_binary(&data, 0, false, 0);
    let before = buf.clone();
    let matrix = uniform_matrix(AccessLevel::Read, 2);
    assert_eq!(matrix.is_uniform(), Some(AccessLevel::Read));

    filter_viewport_buffer(&mut buf, &matrix);

    assert_eq!(buf, before, "Read level must not touch the buffer");
}

#[test]
fn uniform_write_is_passthrough() {
    let data = build_mixed_viewport();
    let mut buf = serialize_viewport_binary(&data, 0, false, 0);
    let before = buf.clone();
    let matrix = uniform_matrix(AccessLevel::Write, 2);

    filter_viewport_buffer(&mut buf, &matrix);

    assert_eq!(buf, before, "Write level must not touch the buffer");
}

#[test]
fn uniform_admin_is_passthrough() {
    let data = build_mixed_viewport();
    let mut buf = serialize_viewport_binary(&data, 0, false, 0);
    let before = buf.clone();
    let matrix = uniform_matrix(AccessLevel::Admin, 2);

    filter_viewport_buffer(&mut buf, &matrix);

    assert_eq!(buf, before, "Admin level must not touch the buffer");
}

// ---------------------------------------------------------------------------
// 4. Mixed matrix — per-column.
// ---------------------------------------------------------------------------

#[test]
fn mixed_matrix_per_cell_denial() {
    // Column 0: None (cells zeroed). Column 1: Read (passthrough).
    let data = build_mixed_viewport();
    let mut buf = serialize_viewport_binary(&data, 0, false, 0);
    let matrix = per_column_matrix(AccessLevel::Read, &[AccessLevel::None, AccessLevel::Read]);
    // Sanity: not uniform.
    assert!(matrix.is_uniform().is_none(), "expected per-column matrix");

    filter_viewport_buffer(&mut buf, &matrix);

    let view = deserialize_viewport(&buf).expect("round-trip");

    // Cell (0,0): col 0 → None → zeroed
    assert_eq!(view.cells[0].number_value, 0.0);
    assert!(view.cells[0].display.is_none());
    assert_eq!(
        view.cells[0].flags & flags::VALUE_TYPE_MASK,
        flags::VALUE_TYPE_NULL
    );
    // Cell (0,1): col 1 → Read → passthrough
    assert_eq!(view.cells[1].display.as_deref(), Some("hello"));
    assert_eq!(
        view.cells[1].flags & flags::VALUE_TYPE_MASK,
        flags::VALUE_TYPE_TEXT
    );

    // Cell (1,0): col 0 → None → zeroed
    assert_eq!(view.cells[2].number_value, 0.0);
    // Cell (1,1): col 1 → Read → passthrough ("#DIV/0!" error text)
    assert_eq!(view.cells[3].error.as_deref(), Some("#DIV/0!"));
}

#[test]
fn mixed_matrix_structure_column() {
    // Column 0: Structure (placeholder). Column 1: Read (passthrough).
    let data = build_mixed_viewport();
    let mut buf = serialize_viewport_binary(&data, 0, false, 0);
    let matrix = per_column_matrix(
        AccessLevel::Read,
        &[AccessLevel::Structure, AccessLevel::Read],
    );
    assert!(matrix.is_uniform().is_none());

    filter_viewport_buffer(&mut buf, &matrix);

    let view = deserialize_viewport(&buf).expect("round-trip");

    // Col 0 → Structure → placeholder by type.
    assert_eq!(view.cells[0].display.as_deref(), Some("#")); // was NUMBER
    assert_eq!(view.cells[2].display.as_deref(), Some("?")); // was BOOL

    // Col 1 → Read → passthrough.
    assert_eq!(view.cells[1].display.as_deref(), Some("hello"));
    assert_eq!(view.cells[3].error.as_deref(), Some("#DIV/0!"));
}

// ---------------------------------------------------------------------------
// 5. Empty buffer — no panic, no-op.
// ---------------------------------------------------------------------------

#[test]
fn empty_buffer_is_noop() {
    // A literal empty Vec.
    let mut buf: Vec<u8> = Vec::new();
    let matrix = uniform_matrix(AccessLevel::None, 0);
    filter_viewport_buffer(&mut buf, &matrix);
    assert!(buf.is_empty());
}

#[test]
fn empty_viewport_produces_valid_output() {
    // An empty viewport (0 cells) is valid and the filter should be a no-op
    // on the cell region while leaving everything else intact.
    let data = build_empty_viewport();
    let mut buf = serialize_viewport_binary(&data, 0, false, 0);
    let before = buf.clone();
    let matrix = uniform_matrix(AccessLevel::None, 0);
    filter_viewport_buffer(&mut buf, &matrix);
    assert_eq!(buf, before, "empty viewport + None must be byte-identical");
}

// ---------------------------------------------------------------------------
// 6. Color overrides are scrubbed under redaction.
// ---------------------------------------------------------------------------

#[test]
fn color_overrides_are_cleared_for_redacted_cells() {
    let data = build_mixed_viewport();
    let mut buf = serialize_viewport_binary(&data, 0, false, 0);
    let matrix = uniform_matrix(AccessLevel::None, 2);

    filter_viewport_buffer(&mut buf, &matrix);
    let view = deserialize_viewport(&buf).expect("round-trip");

    // Cell 0 had nonzero color overrides — they must be cleared under None.
    assert_eq!(view.cells[0].bg_color_override, 0);
    assert_eq!(view.cells[0].font_color_override, 0);
}

// ---------------------------------------------------------------------------
// 7. Structure preserves non-value flags (HAS_FORMULA etc.).
// ---------------------------------------------------------------------------

#[test]
fn structure_preserves_non_value_flags() {
    let mut data = build_single_number_viewport();
    data.cells[0].flags |= flags::HAS_FORMULA | flags::HAS_COMMENT;
    let mut buf = serialize_viewport_binary(&data, 0, false, 0);
    let matrix = uniform_matrix(AccessLevel::Structure, 1);

    filter_viewport_buffer(&mut buf, &matrix);
    let view = deserialize_viewport(&buf).expect("round-trip");

    // Value-type bits preserved, HAS_FORMULA / HAS_COMMENT preserved.
    assert_eq!(
        view.cells[0].flags & flags::VALUE_TYPE_MASK,
        flags::VALUE_TYPE_NUMBER
    );
    assert_ne!(view.cells[0].flags & flags::HAS_FORMULA, 0);
    assert_ne!(view.cells[0].flags & flags::HAS_COMMENT, 0);
}

// ---------------------------------------------------------------------------
// 8. Bench-target sanity check — 100×50 grid, uniform None.
// ---------------------------------------------------------------------------

#[test]
fn uniform_none_large_grid_sanity() {
    // 100 rows × 50 cols = 5000 cells. Not a strict bench — just verifies the
    // O(cells) walk completes promptly and leaves the buffer length unchanged.
    use domain_types::CellFormat;
    let cells: Vec<ViewportRenderCell> = (0..100u32)
        .flat_map(|r| {
            (0..50u32).map(move |c| ViewportRenderCell {
                row: r,
                col: c,
                format_idx: 0,
                flags: flags::VALUE_TYPE_NUMBER,
                number_value: f64::from(r * 50 + c),
                formatted: Some(format!("{}", r * 50 + c)),
                error: None,
                bg_color_override: 0,
                font_color_override: 0,
                cf_extras: None,
            })
        })
        .collect();
    let data = ViewportRenderData {
        cells,
        format_palette: vec![CellFormat::default()],
        merges: Vec::new(),
        row_dimensions: Vec::new(),
        col_dimensions: Vec::new(),
        viewport_rows: 100,
        viewport_cols: 50,
        start_row: 0,
        start_col: 0,
        row_positions: Vec::new(),
        col_positions: Vec::new(),
    };
    let mut buf = serialize_viewport_binary(&data, 0, false, 0);
    let original_len = buf.len();
    let matrix = uniform_matrix(AccessLevel::None, 50);

    let t0 = std::time::Instant::now();
    filter_viewport_buffer(&mut buf, &matrix);
    let elapsed = t0.elapsed();

    assert_eq!(buf.len(), original_len, "uniform None is length-preserving");
    // Not a tight gate — just "completes in a human time". The §12 target is
    // ~200µs for a viewport filter; we allow 10ms here so we don't flake on
    // slow CI runners. A Criterion bench alongside this test would tighten it.
    assert!(
        elapsed < std::time::Duration::from_millis(10),
        "uniform None over 5000 cells took {:?}",
        elapsed
    );
    eprintln!("uniform None over 5000 cells: {:?}", elapsed);
}
