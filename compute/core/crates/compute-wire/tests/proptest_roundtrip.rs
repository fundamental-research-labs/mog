//! Property-based roundtrip tests: any valid ViewportRenderData survives
//! serialize -> deserialize with all fields preserved.

use compute_wire::types::{
    CellCFExtras, DataBarRenderData, IconRenderData, RenderColDimension, RenderRowDimension,
    RenderViewportMerge, ViewportRenderCell, ViewportRenderData,
};
use compute_wire::viewport::serialize_viewport_binary;
use proptest::prelude::*;

use compute_wire::deserialize as deser;

// ---------------------------------------------------------------------------
// Proptest strategies
// ---------------------------------------------------------------------------

/// Generate a valid UTF-8 string of bounded length (bytes, not chars).
/// Avoids generating strings longer than u16::MAX bytes.
fn arb_short_string() -> impl Strategy<Value = String> {
    proptest::string::string_regex("[a-zA-Z0-9 _\\-\u{00e9}\u{00f1}\u{4e16}\u{754c}]{0,200}")
        .unwrap()
}

fn arb_optional_string() -> impl Strategy<Value = Option<String>> {
    prop_oneof![Just(None), arb_short_string().prop_map(Some),]
}

/// Generate a number_value including edge cases.
fn arb_number_value() -> impl Strategy<Value = f64> {
    prop_oneof![
        Just(f64::NAN),
        Just(f64::INFINITY),
        Just(f64::NEG_INFINITY),
        Just(0.0),
        Just(-0.0),
        any::<f64>(),
    ]
}

/// Generate valid cell flags (value type 0-4 in bits 0-2, random upper bits).
fn arb_cell_flags() -> impl Strategy<Value = u16> {
    (0u16..=4u16, any::<u8>()).prop_map(|(vtype, upper)| {
        // bits 0-2: value type, bits 3-10: property flags, bits 11-15: reserved (0)
        let property_bits = (u16::from(upper) & 0xFF) << 3;
        // Mask to only valid flag bits (0-10), clear HAS_CF_EXTRAS (bit 10)
        // since the serializer sets it automatically based on cf_extras presence
        vtype | (property_bits & 0x03F8) // 0x03F8 = bits 3-9
    })
}

fn arb_data_bar() -> impl Strategy<Value = DataBarRenderData> {
    (
        0.0f32..=1.0f32,
        any::<u32>(),
        any::<bool>(),
        any::<bool>(),
        any::<bool>(),
        any::<bool>(),
        0.0f32..=1.0f32,
        any::<u32>(),
    )
        .prop_map(
            |(
                fill_percent,
                color,
                gradient,
                is_negative,
                show_value,
                show_axis,
                axis_position,
                negative_color,
            )| {
                DataBarRenderData {
                    fill_percent,
                    color,
                    gradient,
                    is_negative,
                    show_value,
                    show_axis,
                    axis_position,
                    negative_color,
                }
            },
        )
}

fn arb_icon() -> impl Strategy<Value = IconRenderData> {
    (0u8..24u8, 0u8..10u8, any::<bool>()).prop_map(|(set_name_index, icon_index, icon_only)| {
        IconRenderData {
            set_name_index,
            icon_index,
            icon_only,
        }
    })
}

fn arb_cf_extras() -> impl Strategy<Value = Option<CellCFExtras>> {
    prop_oneof![
        3 => Just(None),
        1 => arb_data_bar().prop_map(|db| Some(CellCFExtras {
            data_bar: Some(db),
            icon: None,
        })),
        1 => arb_icon().prop_map(|ic| Some(CellCFExtras {
            data_bar: None,
            icon: Some(ic),
        })),
        1 => (arb_data_bar(), arb_icon()).prop_map(|(db, ic)| Some(CellCFExtras {
            data_bar: Some(db),
            icon: Some(ic),
        })),
    ]
}

fn arb_cell(row: u32, col: u32) -> impl Strategy<Value = ViewportRenderCell> {
    (
        arb_number_value(),
        arb_optional_string(),
        arb_optional_string(),
        arb_cell_flags(),
        0u16..100u16,
        any::<u32>(),
        any::<u32>(),
        arb_cf_extras(),
    )
        .prop_map(
            move |(
                number_value,
                formatted,
                error,
                flags,
                format_idx,
                bg_color_override,
                font_color_override,
                cf_extras,
            )| {
                ViewportRenderCell {
                    row,
                    col,
                    format_idx,
                    flags,
                    number_value,
                    formatted,
                    error,
                    bg_color_override,
                    font_color_override,
                    cf_extras,
                }
            },
        )
}

fn arb_merge() -> impl Strategy<Value = RenderViewportMerge> {
    (any::<u32>(), any::<u32>(), any::<u32>(), any::<u32>()).prop_map(
        |(start_row, start_col, end_row, end_col)| RenderViewportMerge {
            start_row,
            start_col,
            end_row,
            end_col,
        },
    )
}

fn arb_row_dim() -> impl Strategy<Value = RenderRowDimension> {
    (
        any::<u32>(),
        any::<f32>().prop_filter("must be finite", |v| v.is_finite()),
        any::<bool>(),
    )
        .prop_map(|(row, height, hidden)| RenderRowDimension {
            row,
            height,
            hidden,
        })
}

fn arb_col_dim() -> impl Strategy<Value = RenderColDimension> {
    (
        any::<u32>(),
        any::<f32>().prop_filter("must be finite", |v| v.is_finite()),
        any::<bool>(),
    )
        .prop_map(|(col, width, hidden)| RenderColDimension { col, width, hidden })
}

fn arb_viewport_render_data() -> impl Strategy<Value = ViewportRenderData> {
    // Small grids: 0-10 rows, 0-10 cols
    (0u32..=10u32, 0u32..=10u32).prop_flat_map(|(rows, cols)| {
        let cell_count = (rows * cols) as usize;
        let cells_strategy = if cell_count == 0 {
            Just(vec![]).boxed()
        } else {
            let mut cell_strats = Vec::with_capacity(cell_count);
            for r in 0..rows {
                for c in 0..cols {
                    cell_strats.push(arb_cell(r, c));
                }
            }
            cell_strats.boxed()
        };

        (
            cells_strategy,
            proptest::collection::vec(arb_merge(), 0..=5),
            proptest::collection::vec(arb_row_dim(), 0..=5),
            proptest::collection::vec(arb_col_dim(), 0..=5),
            any::<u32>(), // start_row
            any::<u32>(), // start_col
            Just(rows),
            Just(cols),
        )
            .prop_map(
                move |(
                    cells,
                    merges,
                    row_dimensions,
                    col_dimensions,
                    start_row,
                    start_col,
                    vr,
                    vc,
                )| {
                    // Generate positions matching the wire contract:
                    // length = viewport_rows + 1 (or 0 when empty); the trailing
                    // entry is the sentinel for the row after the range.
                    let row_positions: Vec<f64> = if vr > 0 {
                        (0..=vr).map(|i| f64::from(i) * 20.0).collect()
                    } else {
                        Vec::new()
                    };
                    let col_positions: Vec<f64> = if vc > 0 {
                        (0..=vc).map(|i| f64::from(i) * 80.0).collect()
                    } else {
                        Vec::new()
                    };
                    ViewportRenderData {
                        cells,
                        format_palette: vec![], // palette is tested via JSON roundtrip
                        merges,
                        row_dimensions,
                        col_dimensions,
                        viewport_rows: vr,
                        viewport_cols: vc,
                        start_row,
                        start_col,
                        row_positions,
                        col_positions,
                    }
                },
            )
    })
}

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

/// Compare two f64 values, treating NaN == NaN and -0 == +0.
fn f64_eq(a: f64, b: f64) -> bool {
    if a.is_nan() && b.is_nan() {
        // Both NaN — considered equal for roundtrip
        return true;
    }
    a.to_bits() == b.to_bits()
}

// ---------------------------------------------------------------------------
// Roundtrip test
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn viewport_roundtrip(data in arb_viewport_render_data(), generation in any::<u8>(), is_delta in any::<bool>()) {
        let buf = serialize_viewport_binary(&data, generation, is_delta, 0);
        let d = deser::deserialize_viewport(&buf).unwrap();

        // Header fields
        prop_assert_eq!(d.start_row, data.start_row);
        prop_assert_eq!(d.start_col, data.start_col);
        prop_assert_eq!(d.cell_count, data.cells.len() as u32);
        prop_assert_eq!(d.viewport_rows, data.viewport_rows.min(u32::from(u16::MAX)) as u16);
        prop_assert_eq!(d.viewport_cols, data.viewport_cols.min(u32::from(u16::MAX)) as u16);
        prop_assert_eq!(d.generation, generation);
        prop_assert_eq!(d.is_delta, is_delta);
        prop_assert_eq!(d.wire_version, compute_wire::constants::WIRE_VERSION);
        // Palette formats should round-trip (non-empty palette produces formats)
        // Note: palette_formats may be empty if the input palette was empty
        prop_assert!(d.palette_start_index == 0 || !d.palette_formats.is_empty(), "palette should round-trip");

        // Cells
        prop_assert_eq!(d.cells.len(), data.cells.len());
        for (i, (dc, sc)) in d.cells.iter().zip(data.cells.iter()).enumerate() {
            prop_assert!(
                f64_eq(dc.number_value, sc.number_value),
                "cell[{}] number_value mismatch: {:?} vs {:?}", i, dc.number_value, sc.number_value
            );
            prop_assert_eq!(&dc.display, &sc.formatted, "cell[{}] display mismatch", i);
            prop_assert_eq!(&dc.error, &sc.error, "cell[{}] error mismatch", i);
            // flags: the serializer may set HAS_CF_EXTRAS (bit 10) automatically
            let expected_flags = if sc.cf_extras.is_some() {
                sc.flags | compute_wire::flags::HAS_CF_EXTRAS
            } else {
                sc.flags & !compute_wire::flags::HAS_CF_EXTRAS
            };
            prop_assert_eq!(dc.flags, expected_flags, "cell[{}] flags mismatch", i);
            prop_assert_eq!(dc.format_idx, sc.format_idx, "cell[{}] format_idx mismatch", i);
            prop_assert_eq!(dc.bg_color_override, sc.bg_color_override, "cell[{}] bg_color mismatch", i);
            prop_assert_eq!(dc.font_color_override, sc.font_color_override, "cell[{}] font_color mismatch", i);
        }

        // Merges
        prop_assert_eq!(d.merges.len(), data.merges.len());
        for (i, (dm, sm)) in d.merges.iter().zip(data.merges.iter()).enumerate() {
            prop_assert_eq!(dm.start_row, sm.start_row, "merge[{}] start_row", i);
            prop_assert_eq!(dm.start_col, sm.start_col, "merge[{}] start_col", i);
            prop_assert_eq!(dm.end_row, sm.end_row, "merge[{}] end_row", i);
            prop_assert_eq!(dm.end_col, sm.end_col, "merge[{}] end_col", i);
        }

        // Row dims
        prop_assert_eq!(d.row_dims.len(), data.row_dimensions.len());
        for (i, (dd, sd)) in d.row_dims.iter().zip(data.row_dimensions.iter()).enumerate() {
            prop_assert_eq!(dd.row, sd.row, "row_dim[{}] row", i);
            prop_assert_eq!(dd.height, sd.height, "row_dim[{}] height", i);
            prop_assert_eq!(dd.hidden, sd.hidden, "row_dim[{}] hidden", i);
        }

        // Col dims
        prop_assert_eq!(d.col_dims.len(), data.col_dimensions.len());
        for (i, (dd, sd)) in d.col_dims.iter().zip(data.col_dimensions.iter()).enumerate() {
            prop_assert_eq!(dd.col, sd.col, "col_dim[{}] col", i);
            prop_assert_eq!(dd.width, sd.width, "col_dim[{}] width", i);
            prop_assert_eq!(dd.hidden, sd.hidden, "col_dim[{}] hidden", i);
        }

        // Data bars: collect expected from cells
        let mut expected_data_bars: Vec<(u32, &DataBarRenderData)> = Vec::new();
        for (idx, cell) in data.cells.iter().enumerate() {
            if let Some(ref extras) = cell.cf_extras
                && let Some(ref db) = extras.data_bar
            {
                expected_data_bars.push((idx as u32, db));
            }
        }
        prop_assert_eq!(d.data_bars.len(), expected_data_bars.len());
        for (i, (dd, (exp_idx, exp_db))) in d.data_bars.iter().zip(expected_data_bars.iter()).enumerate() {
            prop_assert_eq!(dd.cell_index, *exp_idx, "data_bar[{}] cell_index", i);
            prop_assert_eq!(dd.fill_percent, exp_db.fill_percent, "data_bar[{}] fill_percent", i);
            prop_assert_eq!(dd.color, exp_db.color, "data_bar[{}] color", i);
            prop_assert_eq!(dd.gradient, exp_db.gradient, "data_bar[{}] gradient", i);
            prop_assert_eq!(dd.is_negative, exp_db.is_negative, "data_bar[{}] is_negative", i);
            prop_assert_eq!(dd.show_value, exp_db.show_value, "data_bar[{}] show_value", i);
            prop_assert_eq!(dd.show_axis, exp_db.show_axis, "data_bar[{}] show_axis", i);
            prop_assert_eq!(dd.axis_position, exp_db.axis_position, "data_bar[{}] axis_position", i);
            prop_assert_eq!(dd.negative_color, exp_db.negative_color, "data_bar[{}] negative_color", i);
        }

        // Icons: collect expected from cells
        let mut expected_icons: Vec<(u32, &IconRenderData)> = Vec::new();
        for (idx, cell) in data.cells.iter().enumerate() {
            if let Some(ref extras) = cell.cf_extras
                && let Some(ref icon) = extras.icon
            {
                expected_icons.push((idx as u32, icon));
            }
        }
        prop_assert_eq!(d.icons.len(), expected_icons.len());
        for (i, (di, (exp_idx, exp_ic))) in d.icons.iter().zip(expected_icons.iter()).enumerate() {
            prop_assert_eq!(di.cell_index, *exp_idx, "icon[{}] cell_index", i);
            prop_assert_eq!(di.set_name_index, exp_ic.set_name_index, "icon[{}] set_name_index", i);
            prop_assert_eq!(di.icon_index, exp_ic.icon_index, "icon[{}] icon_index", i);
            prop_assert_eq!(di.icon_only, exp_ic.icon_only, "icon[{}] icon_only", i);
        }

        // Row/col positions
        prop_assert_eq!(d.row_positions.len(), data.row_positions.len());
        for (i, (dp, sp)) in d.row_positions.iter().zip(data.row_positions.iter()).enumerate() {
            prop_assert!(f64_eq(*dp, *sp), "row_positions[{}] mismatch: {} vs {}", i, dp, sp);
        }
        prop_assert_eq!(d.col_positions.len(), data.col_positions.len());
        for (i, (dp, sp)) in d.col_positions.iter().zip(data.col_positions.iter()).enumerate() {
            prop_assert!(f64_eq(*dp, *sp), "col_positions[{}] mismatch: {} vs {}", i, dp, sp);
        }
    }
}

// ---------------------------------------------------------------------------
// Explicit edge-case tests
// ---------------------------------------------------------------------------

#[test]
fn empty_viewport_roundtrip() {
    let data = ViewportRenderData {
        cells: vec![],
        format_palette: vec![],
        merges: vec![],
        row_dimensions: vec![],
        col_dimensions: vec![],
        viewport_rows: 0,
        viewport_cols: 0,
        start_row: 0,
        start_col: 0,
        row_positions: vec![],
        col_positions: vec![],
    };
    let buf = serialize_viewport_binary(&data, 0, false, 0);
    let d = deser::deserialize_viewport(&buf).unwrap();
    assert_eq!(d.cell_count, 0);
    assert_eq!(d.cells.len(), 0);
    assert_eq!(d.merges.len(), 0);
    assert!(!d.is_delta);
}

#[test]
fn single_cell_with_all_flags() {
    let data = ViewportRenderData {
        cells: vec![ViewportRenderCell {
            row: 0,
            col: 0,
            format_idx: 42,
            // All property flags set + value type = Number (1)
            flags: 0x03F9, // bits 0-2 = 1 (Number), bits 3-9 all set
            number_value: 42.0,
            formatted: Some("42".to_string()),
            error: None,
            bg_color_override: 0xFF00FF00,
            font_color_override: 0x00FF0000,
            cf_extras: Some(CellCFExtras {
                data_bar: Some(DataBarRenderData {
                    fill_percent: 0.75,
                    color: 0xAABBCCDD,
                    gradient: true,
                    is_negative: false,
                    show_value: true,
                    show_axis: true,
                    axis_position: 0.5,
                    negative_color: 0x11223344,
                }),
                icon: Some(IconRenderData {
                    set_name_index: 5,
                    icon_index: 2,
                    icon_only: true,
                }),
            }),
        }],
        format_palette: vec![],
        merges: vec![],
        row_dimensions: vec![],
        col_dimensions: vec![],
        viewport_rows: 1,
        viewport_cols: 1,
        start_row: 100,
        start_col: 200,
        // Length = viewport_{rows,cols} + 1 (1 entry + 1 sentinel).
        row_positions: vec![0.0, 21.0],
        col_positions: vec![0.0, 64.0],
    };
    let buf = serialize_viewport_binary(&data, 7, true, 0);
    let d = deser::deserialize_viewport(&buf).unwrap();

    assert_eq!(d.start_row, 100);
    assert_eq!(d.start_col, 200);
    assert_eq!(d.generation, 7);
    assert!(d.is_delta);
    assert_eq!(d.cells.len(), 1);

    let cell = &d.cells[0];
    assert_eq!(cell.number_value, 42.0);
    assert_eq!(cell.display.as_deref(), Some("42"));
    assert!(cell.error.is_none());
    assert_eq!(cell.format_idx, 42);
    assert_eq!(cell.bg_color_override, 0xFF00FF00);
    assert_eq!(cell.font_color_override, 0x00FF0000);

    // HAS_CF_EXTRAS should be set by serializer
    assert_ne!(cell.flags & compute_wire::flags::HAS_CF_EXTRAS, 0);

    assert_eq!(d.data_bars.len(), 1);
    let db = &d.data_bars[0];
    assert_eq!(db.cell_index, 0);
    assert_eq!(db.fill_percent, 0.75);
    assert!(db.gradient);
    assert!(!db.is_negative);
    assert!(db.show_value);
    assert!(db.show_axis);

    assert_eq!(d.icons.len(), 1);
    let ic = &d.icons[0];
    assert_eq!(ic.cell_index, 0);
    assert_eq!(ic.set_name_index, 5);
    assert_eq!(ic.icon_index, 2);
    assert!(ic.icon_only);
}

#[test]
fn unicode_strings_roundtrip() {
    let data = ViewportRenderData {
        cells: vec![ViewportRenderCell {
            row: 0,
            col: 0,
            format_idx: 0,
            flags: 2, // Text
            number_value: f64::NAN,
            formatted: Some("\u{4e16}\u{754c}\u{4f60}\u{597d} Hello \u{00e9}\u{00f1}".to_string()),
            error: Some("\u{2603} snowman error".to_string()),
            bg_color_override: 0,
            font_color_override: 0,
            cf_extras: None,
        }],
        format_palette: vec![],
        merges: vec![],
        row_dimensions: vec![],
        col_dimensions: vec![],
        viewport_rows: 1,
        viewport_cols: 1,
        start_row: 0,
        start_col: 0,
        // Length = viewport_{rows,cols} + 1 (1 entry + 1 sentinel).
        row_positions: vec![0.0, 21.0],
        col_positions: vec![0.0, 64.0],
    };
    let buf = serialize_viewport_binary(&data, 0, false, 0);
    let d = deser::deserialize_viewport(&buf).unwrap();

    assert_eq!(
        d.cells[0].display.as_deref(),
        Some("\u{4e16}\u{754c}\u{4f60}\u{597d} Hello \u{00e9}\u{00f1}")
    );
    assert_eq!(d.cells[0].error.as_deref(), Some("\u{2603} snowman error"));
}
