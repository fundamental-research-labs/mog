//! Wire format definitions and binary serializers for the Rust↔TypeScript
//! viewport protocol.
//!
//! # Overview
//!
//! `compute-wire` is the **single source of truth** for the binary protocol
//! used by the compute engine for explicit viewport snapshots. It owns:
//!
//! - **Constants** ([`constants`]) — header sizes, strides, byte offsets, sentinels.
//! - **Flags** ([`flags`]) — cell flag bits, [`flags::ValueType`] enum.
//! - **Types** ([`types`]) — render-only structs (`ViewportRenderData`, `CellCFExtras`, …).
//! - **Serializers** ([`viewport`]) — binary encoder for viewport snapshots.
//! - **Palette** ([`palette::FormatPalette`]) — append-only format deduplication.
//!
//! # Wire Protocol (all little-endian)
//!
//! ## Viewport binary (`serialize_viewport_binary`)
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │ Header              36 B                                    │
//! │   start_row(u32) start_col(u32) cell_count(u32)            │
//! │   palette_len(u32) string_pool_bytes(u32)                  │
//! │   rows(u16) cols(u16) merges(u16) row_dims(u16) col_dims(u16)│
//! │   flags(u8) generation(u8) data_bars(u16) icons(u16)       │
//! ├─────────────────────────────────────────────────────────────┤
//! │ Cell Records        N × 32 B  (dense, row-major)           │
//! │ String Pool         variable   (UTF-8, no null terminators)│
//! │ Merge Records       M × 16 B                               │
//! │ Row Dimensions      R × 12 B                               │
//! │ Col Dimensions      C × 12 B                               │
//! │ Format Palette     variable   (binary, extensible)         │
//! │ Data Bar Entries    D × 24 B  (sparse by cell_index)       │
//! │ Icon Entries        I × 8 B   (sparse by cell_index)       │
//! │ Row Positions       R × 8 B   (f64 pixel Y)               │
//! │ Col Positions       C × 8 B   (f64 pixel X)               │
//! └─────────────────────────────────────────────────────────────┘
//! ```
//!
//! ## Protocol versioning
//!
//! The viewport header flags byte embeds [`constants::WIRE_VERSION`] in bits 4-7.
//! TypeScript decoders should validate this before reading the buffer. Bump the
//! version on any breaking layout change.
//!
//! # Safety
//!
//! This crate uses `#![forbid(unsafe_code)]` — all byte manipulation is done
//! via safe `to_le_bytes()` / `extend_from_slice()` methods. No transmutes,
//! no pointer arithmetic, no undefined behavior.

#![forbid(unsafe_code)]
#![deny(clippy::all)]
#![warn(clippy::pedantic)]
#![deny(missing_docs)]

pub mod constants;
pub mod flags;
pub mod palette;
pub mod palette_binary;
pub mod security_filter;
pub mod types;
pub mod viewport;

/// Test-only binary deserializer for the viewport wire format.
///
/// **Not part of the stable public API.** Exposed for integration tests
/// and downstream test code via the `test-utils` feature flag.
#[cfg(any(test, feature = "test-utils"))]
pub mod deserialize;

/// Returns the JSON (camelCase) field names of [`domain_types::CellFormat`] as
/// serialized by serde.
///
/// This is used by `generate_ts.rs` to emit a compile-time field list that TS tests
/// compare against the hand-maintained `CellFormat` interface in contracts.
/// If a field is added/removed in Rust but not TS (or vice versa), a test fails.
///
/// # Panics
///
/// Panics if `CellFormat` cannot be serialized to JSON (should never happen).
///
/// # Examples
///
/// ```
/// let fields = compute_wire::cell_format_json_fields();
/// assert!(fields.contains(&"bold".to_string()));
/// assert!(fields.contains(&"fontSize".to_string()));
/// // Fields are sorted alphabetically
/// let mut sorted = fields.clone();
/// sorted.sort();
/// assert_eq!(fields, sorted);
/// ```
#[must_use]
pub fn cell_format_json_fields() -> Vec<String> {
    // Serialize with every field set to Some so skip_serializing_if doesn't omit them.
    let full = domain_types::CellFormat {
        font_family: Some(String::new()),
        font_size: Some(domain_types::FontSize::from_points(0.0)),
        font_color: Some(String::new()),
        font_color_tint: Some(0.0),
        bold: Some(false),
        italic: Some(false),
        underline_type: Some(ooxml_types::styles::UnderlineStyle::None),
        strikethrough: Some(false),
        superscript: Some(false),
        subscript: Some(false),
        font_outline: Some(false),
        font_shadow: Some(false),
        font_theme: Some(String::new()),
        font_charset: Some(0),
        font_family_type: Some(0),
        horizontal_align: Some(ooxml_types::styles::HorizontalAlign::General),
        vertical_align: Some(domain_types::CellVerticalAlign::Bottom),
        wrap_text: Some(false),
        indent: Some(0),
        text_rotation: Some(0),
        shrink_to_fit: Some(false),
        reading_order: Some(String::new()),
        auto_indent: Some(false),
        number_format: Some(String::new()),
        background_color: Some(String::new()),
        background_color_tint: Some(0.0),
        pattern_type: Some(ooxml_types::styles::PatternType::None),
        pattern_foreground_color: Some(String::new()),
        pattern_foreground_color_tint: Some(0.0),
        gradient_fill: Some(domain_types::GradientFillFormat {
            gradient_type: String::new(),
            degree: Some(0.0),
            center: None,
            stops: vec![],
        }),
        borders: Some(domain_types::CellBorders::default()),
        locked: Some(false),
        hidden: Some(false),
        quote_prefix: Some(false),
        pivot_button: Some(false),
        extensions: Some(std::collections::BTreeMap::new()),
    };
    let val = serde_json::to_value(full).expect("CellFormat must serialize");
    let obj = val
        .as_object()
        .expect("CellFormat must serialize as object");
    let mut fields: Vec<String> = obj.keys().cloned().collect();
    fields.sort();
    fields
}

// Re-export key items at crate root for convenience
pub use constants::*;
pub use flags::*;
pub use palette::FormatPalette;
pub use palette::PaletteFullError;
pub use palette_binary::{
    PaletteBinaryError, deserialize_palette_binary, serialize_palette_binary,
};
pub use security_filter::filter_viewport_buffer;
pub use types::{
    CellCFExtras, DataBarRenderData, IconRenderData, PaletteSnapshot, RenderColDimension,
    RenderRowDimension, RenderViewportMerge, ViewportBounds, ViewportRenderCell,
    ViewportRenderData,
};
pub use viewport::serialize_viewport_binary;

#[cfg(test)]
#[allow(clippy::uninlined_format_args)]
mod cell_format_drift_tests {
    use super::*;

    /// Ensures `cell_format_json_fields()` lists every field in the struct.
    /// If a new field is added to `CellFormat` but not to the explicit constructor
    /// in `cell_format_json_fields()`, this test catches it because the Rust
    /// compiler will refuse to compile the non-exhaustive struct literal.
    /// This test additionally validates the output is non-empty and sorted.
    #[test]
    fn field_list_is_complete_and_sorted() {
        let fields = cell_format_json_fields();
        assert!(
            fields.len() >= 20,
            "Expected at least 20 CellFormat fields, got {}",
            fields.len()
        );
        // Verify sorted
        let mut sorted = fields.clone();
        sorted.sort();
        assert_eq!(fields, sorted, "Fields must be sorted alphabetically");
    }

    /// Verifies that all expected fields are present in the output.
    /// If this list gets out of date, either this test or the compiler
    /// (via the exhaustive struct literal) will catch it.
    #[test]
    fn known_fields_are_present() {
        let fields = cell_format_json_fields();
        let expected = [
            "autoIndent",
            "backgroundColor",
            "backgroundColorTint",
            "bold",
            "borders",
            "extensions",
            "fontCharset",
            "fontColor",
            "fontColorTint",
            "fontFamily",
            "fontFamilyType",
            "fontOutline",
            "fontShadow",
            "fontSize",
            "fontTheme",
            "gradientFill",
            "hidden",
            "horizontalAlign",
            "indent",
            "italic",
            "locked",
            "numberFormat",
            "patternForegroundColor",
            "patternForegroundColorTint",
            "patternType",
            "pivotButton",
            "quotePrefix",
            "readingOrder",
            "shrinkToFit",
            "strikethrough",
            "subscript",
            "superscript",
            "textRotation",
            "underlineType",
            "verticalAlign",
            "wrapText",
        ];
        for field in &expected {
            assert!(
                fields.contains(&field.to_string()),
                "Missing expected field: {}",
                field
            );
        }
        // Also verify counts match — if a new field is added to the struct,
        // the compiler forces updating cell_format_json_fields(), and this
        // assertion forces updating the expected list here.
        assert_eq!(
            fields.len(),
            expected.len(),
            "Field count mismatch — update the expected list in this test. Got: {:?}",
            fields
        );
    }
}
