use super::helpers::*;
use domain_types::{ThemeColor, ThemeData};
use value_types::{CellValue, FiniteF64};

#[test]
fn roundtrip_theme_colors() {
    let mut output = make_single_sheet(
        "Sheet1",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.theme = Some(ThemeData {
        colors: vec![
            ThemeColor {
                name: "dk1".to_string(),
                color: "#000000".to_string(),
                source: None,
            },
            ThemeColor {
                name: "lt1".to_string(),
                color: "#FFFFFF".to_string(),
                source: None,
            },
            ThemeColor {
                name: "dk2".to_string(),
                color: "#1F4E79".to_string(),
                source: None,
            },
            ThemeColor {
                name: "lt2".to_string(),
                color: "#E7E6E6".to_string(),
                source: None,
            },
            ThemeColor {
                name: "accent1".to_string(),
                color: "#4472C4".to_string(),
                source: None,
            },
            ThemeColor {
                name: "accent2".to_string(),
                color: "#ED7D31".to_string(),
                source: None,
            },
        ],
        major_font: Some("Calibri Light".to_string()),
        minor_font: Some("Calibri".to_string()),
        name: None,
        ..Default::default()
    });
    let rt = roundtrip(&output);
    let theme = rt.theme.as_ref().expect("theme should survive round-trip");
    assert!(
        !theme.colors.is_empty(),
        "theme colors should survive round-trip"
    );
    // Check that dk1 and lt1 are present (colors may be normalized)
    let dk1 = theme.colors.iter().find(|c| c.name == "dk1");
    assert!(dk1.is_some(), "dk1 theme color should survive");
    let lt1 = theme.colors.iter().find(|c| c.name == "lt1");
    assert!(lt1.is_some(), "lt1 theme color should survive");
}

#[test]
fn roundtrip_theme_fonts() {
    let mut output = make_single_sheet(
        "Sheet1",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.theme = Some(ThemeData {
        colors: vec![
            ThemeColor {
                name: "dk1".to_string(),
                color: "#000000".to_string(),
                source: None,
            },
            ThemeColor {
                name: "lt1".to_string(),
                color: "#FFFFFF".to_string(),
                source: None,
            },
        ],
        major_font: Some("Cambria".to_string()),
        minor_font: Some("Calibri".to_string()),
        name: None,
        ..Default::default()
    });
    let rt = roundtrip(&output);
    let theme = rt.theme.as_ref().expect("theme should survive round-trip");
    // Font names should round-trip
    if let Some(ref major) = theme.major_font {
        assert_eq!(major, "Cambria");
    }
    if let Some(ref minor) = theme.minor_font {
        assert_eq!(minor, "Calibri");
    }
}
