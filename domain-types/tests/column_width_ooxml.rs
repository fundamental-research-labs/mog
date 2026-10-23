//! Stored XLSX column widths already include the cell padding.
//!
//! Reference: https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.column

use domain_types::units::{CharWidth, Pixels, char_width_to_pixels, pixels_to_char_width};

#[test]
fn stored_ooxml_width_does_not_add_padding_twice() {
    // The specification's 8-character, MDW=7 example is stored as 8.7109375.
    assert_eq!(
        char_width_to_pixels(CharWidth(8.7109375), 7.0),
        Pixels(61.0)
    );
}

#[test]
fn explicit_pixel_width_exports_as_total_ooxml_width() {
    // Office.js columnWidth is points: 24 points at 96 DPI is 32 pixels.
    let stored = pixels_to_char_width(Pixels(32.0), 7.0);
    assert_eq!(stored, CharWidth(4.5703125));
    assert_eq!(char_width_to_pixels(stored, 7.0), Pixels(32.0));
}
