use crate::domain::cells::{
    CELL_TYPE_NUMBER, CELL_TYPE_STRING, CellData, VALUE_TYPE_FORMULA, VALUE_TYPE_NONE,
    parse_worksheet_fast,
};

#[test]
#[ignore] // Requires /tmp/xlsx_test_sheet.xml and /tmp/xlsx_test_ss.xml from manual extraction
fn test_parse_real_xlsx_worksheet() {
    // Load the actual worksheet XML from the golden LBO test file
    let xml = std::fs::read("/tmp/xlsx_test_sheet.xml")
        .expect("Failed to read test sheet XML - run python extraction first");
    let ss_xml =
        std::fs::read("/tmp/xlsx_test_ss.xml").expect("Failed to read test shared strings XML");

    // Parse shared strings
    let mut ss_parser = crate::domain::strings::read::SharedStrings::parse(ss_xml);
    let ss_count = ss_parser.len();
    let mut shared_string_values: Vec<String> = Vec::with_capacity(ss_count);
    for i in 0..ss_count {
        let bytes = ss_parser.get(i);
        shared_string_values.push(String::from_utf8_lossy(bytes).into_owned());
    }
    let shared_string_refs: Vec<&str> = shared_string_values.iter().map(|s| s.as_str()).collect();

    eprintln!("Shared strings count: {}", ss_count);
    eprintln!("Worksheet XML size: {} bytes", xml.len());

    // Allocate buffers
    let estimated_cells = xml.len() / 50;
    let mut cells = vec![CellData::default(); estimated_cells.max(3000)];
    let mut strings = Vec::with_capacity(estimated_cells * 20);

    // Parse
    let count = parse_worksheet_fast(
        &xml,
        &shared_string_refs,
        &mut cells,
        &mut strings,
        &mut Vec::new(),
        &[],
    );

    eprintln!("Cells parsed: {}", count);

    // Show first 10 cells
    for i in 0..count.min(10) {
        let c = &cells[i];
        let row = c.get_row();
        let col = c.get_col();
        let style_idx = c.get_style_idx();
        let val_offset = c.get_value_offset() as usize;
        let val_len = c.get_value_len() as usize;
        let value_str = if val_len > 0 && val_offset < strings.len() {
            let end = (val_offset + val_len).min(strings.len());
            String::from_utf8_lossy(&strings[val_offset..end]).to_string()
        } else {
            "(empty)".to_string()
        };
        eprintln!(
            "  Cell[{}]: row={}, col={}, type={}, style={}, value_type={}, value={}",
            i,
            row,
            col,
            c.cell_type,
            style_idx,
            c.value_type,
            &value_str[..value_str.len().min(80)]
        );
    }

    // Show cell type distribution
    let mut type_counts = [0u32; 6];
    let mut value_type_counts = [0u32; 5];
    for i in 0..count {
        let c = &cells[i];
        if (c.cell_type as usize) < type_counts.len() {
            type_counts[c.cell_type as usize] += 1;
        }
        if (c.value_type as usize) < value_type_counts.len() {
            value_type_counts[c.value_type as usize] += 1;
        }
    }
    eprintln!("\nCell type distribution:");
    eprintln!("  EMPTY(0): {}", type_counts[0]);
    eprintln!("  NUMBER(1): {}", type_counts[1]);
    eprintln!("  STRING(2): {}", type_counts[2]);
    eprintln!("  BOOL(3): {}", type_counts[3]);
    eprintln!("  ERROR(4): {}", type_counts[4]);
    eprintln!("  FORMULA(5): {}", type_counts[5]);

    eprintln!("\nValue type distribution:");
    eprintln!("  NONE(0): {}", value_type_counts[0]);
    eprintln!("  INLINE(1): {}", value_type_counts[1]);
    eprintln!("  SHARED_STRING(2): {}", value_type_counts[2]);
    eprintln!("  FORMULA(3): {}", value_type_counts[3]);
    eprintln!("  CACHED_FORMULA(4): {}", value_type_counts[4]);

    // Count cells by cell_type AND value_type combination
    let mut formula_string = 0u32;
    let mut formula_number = 0u32;
    for i in 0..count {
        let c = &cells[i];
        if c.value_type == VALUE_TYPE_FORMULA {
            if c.cell_type == CELL_TYPE_STRING {
                formula_string += 1;
            } else if c.cell_type == CELL_TYPE_NUMBER {
                formula_number += 1;
            }
        }
    }
    eprintln!("\nFormula cells with cell_type STRING: {}", formula_string);
    eprintln!("Formula cells with cell_type NUMBER: {}", formula_number);

    // Count cells that have no value but have styling (these are style-only cells)
    let mut style_only = 0u32;
    for i in 0..count {
        let c = &cells[i];
        if c.value_type == VALUE_TYPE_NONE {
            let style = c.get_style_idx();
            if style != 0 {
                style_only += 1;
            }
        }
    }
    eprintln!("Style-only cells (no value, style > 0): {}", style_only);

    // The file has ~2011 cells total, ~1378 with values
    // At minimum we should parse significantly more than 70
    assert!(count > 100, "Expected more than 100 cells, got {}", count);
}
