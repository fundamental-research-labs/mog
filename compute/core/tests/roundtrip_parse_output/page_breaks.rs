use super::helpers::*;
use domain_types::PageBreaks;
use value_types::{CellValue, FiniteF64};

#[test]
fn roundtrip_page_breaks() {
    let mut output = make_single_sheet(
        "Sheet1",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    use domain_types::domain::print::PageBreakEntry;
    output.sheets[0].page_breaks = Some(PageBreaks {
        row_breaks: vec![
            PageBreakEntry {
                id: 10,
                min: 0,
                max: 1048576,
                manual: true,
                pt: false,
            },
            PageBreakEntry {
                id: 20,
                min: 0,
                max: 1048576,
                manual: true,
                pt: false,
            },
        ],
        col_breaks: vec![PageBreakEntry {
            id: 5,
            min: 0,
            max: 16384,
            manual: true,
            pt: false,
        }],
    });
    let rt = roundtrip(&output);
    let pb = rt.sheets[0]
        .page_breaks
        .as_ref()
        .expect("page_breaks should survive round-trip");
    assert_eq!(pb.row_breaks.len(), 2);
    assert_eq!(pb.row_breaks[0].id, 10);
    assert_eq!(pb.row_breaks[1].id, 20);
    assert_eq!(pb.col_breaks.len(), 1);
    assert_eq!(pb.col_breaks[0].id, 5);
}

#[test]
fn roundtrip_page_breaks_empty() {
    let mut output = make_single_sheet(
        "Sheet1",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.sheets[0].page_breaks = Some(PageBreaks {
        row_breaks: vec![],
        col_breaks: vec![],
    });
    let rt = roundtrip(&output);
    // Empty page breaks may or may not survive (parser might omit empty struct).
    // If present, they should be empty.
    if let Some(pb) = rt.sheets[0].page_breaks.as_ref() {
        assert!(pb.row_breaks.is_empty());
        assert!(pb.col_breaks.is_empty());
    }
}
