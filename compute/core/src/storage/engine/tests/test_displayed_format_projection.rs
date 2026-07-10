//! Differential coverage for the displayed-format batch range sweep.

use super::super::*;
use super::helpers::*;
use domain_types::CellFormat;

#[test]
fn displayed_format_projection_matches_scalar_for_range_sweep_edge_cases() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    {
        let (stores, mirror) = (&mut engine.stores, &mut engine.mirror);
        let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();

        // A deterministic mix of disjoint and heavily overlapping rectangles.
        let mut state = 0x9E37_79B9_u32;
        for index in 0..32_u32 {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let start_row = state % 12;
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let start_col = state % 10;
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let end_row = (start_row + state % 6).min(11);
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let end_col = (start_col + state % 5).min(9);
            let format = match index % 4 {
                0 => CellFormat {
                    bold: Some(index % 8 == 0),
                    ..Default::default()
                },
                1 => CellFormat {
                    italic: Some(index % 8 == 1),
                    ..Default::default()
                },
                2 => CellFormat {
                    background_color: Some(format!("#{:06X}", index * 97)),
                    ..Default::default()
                },
                _ => CellFormat {
                    font_size: Some((8.0 + f64::from(index % 7)).into()),
                    ..Default::default()
                },
            };
            crate::storage::properties::add_format_range(
                &mut stores.storage,
                &sid,
                sheet_mirror,
                crate::mirror::RangeId::from_raw(u128::from(1_000 + index)),
                start_row,
                start_col,
                end_row,
                end_col,
                &format,
            );
        }

        // Invalid rectangles can arrive through imported or collaborative state.
        // Neither orientation may affect a cell or panic the batch sweep.
        for (id, start_row, start_col, end_row, end_col) in
            [(2_000, 9, 0, 4, 9), (2_001, 0, 8, 11, 3)]
        {
            crate::storage::properties::add_format_range(
                &mut stores.storage,
                &sid,
                sheet_mirror,
                crate::mirror::RangeId::from_raw(id),
                start_row,
                start_col,
                end_row,
                end_col,
                &CellFormat {
                    strikethrough: Some(true),
                    ..Default::default()
                },
            );
        }
    }

    let mut positions = (0..12)
        .flat_map(|row| (0..10).map(move |col| (row, col)))
        .collect::<Vec<_>>();
    positions.extend([(0, 0), (5, 5), (11, 9)]);
    let projection = engine.get_displayed_formats_for_cells(&sid, &positions);

    for (index, &(row, col)) in positions.iter().enumerate() {
        let batch = &projection.palette[projection.format_ids[index] as usize];
        let scalar = engine.get_displayed_cell_properties(&sid, row, col);
        assert_eq!(batch, &scalar, "range sweep mismatch at ({row}, {col})");
        assert_ne!(
            batch.strikethrough,
            Some(true),
            "invalid ranges must be ignored"
        );
    }
}
