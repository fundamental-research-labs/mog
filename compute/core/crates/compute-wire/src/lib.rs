//! Wire format definitions and binary serializers for the Rust↔TypeScript
//! viewport and mutation protocols.
//!
//! # Overview
//!
//! `compute-wire` is the **single source of truth** for the binary protocol
//! between the Rust compute engine and the TypeScript renderer. It owns:
//!
//! - **Constants** ([`constants`]) — header sizes, strides, byte offsets, sentinels.
//! - **Flags** ([`flags`]) — cell flag bits, [`flags::ValueType`] enum, mutation header flags.
//! - **Types** ([`types`]) — render-only structs (`ViewportRenderData`, `CellCFExtras`, …).
//! - **Serializers** ([`viewport`], [`mutation`]) — binary encoders for viewport and mutation blobs.
//! - **Palette** ([`palette::FormatPalette`]) — append-only format deduplication.
//! - **Codegen** ([`generate_constants_ts`]) — generates `constants.gen.ts` so the TS
//!   decoder stays in lock-step with Rust.
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
//! ## Mutation binary (`serialize_mutation_result`)
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │ Header              16 B                                    │
//! │   patch_count(u32) string_bytes(u32)                       │
//! │   sheet_id_len(u16) flags(u8) generation(u8) reserved(u32)│
//! ├─────────────────────────────────────────────────────────────┤
//! │ Sheet ID            variable   (UTF-8)                     │
//! │ Cell Patches        N × 40 B  (row+col+32B cell record)   │
//! │ String Pool         variable                               │
//! │ Spill Section       optional   (u32 count + patches)       │
//! │ Palette Section     optional   (u16 idx + u32 len + binary)│
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
pub mod mutation;
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
    };
    let val = serde_json::to_value(full).expect("CellFormat must serialize");
    let obj = val
        .as_object()
        .expect("CellFormat must serialize as object");
    let mut fields: Vec<String> = obj.keys().cloned().collect();
    fields.sort();
    fields
}

/// Generates the full contents of `constants.gen.ts` as a `String`.
///
/// This is the single source of truth for the TypeScript constants file.
/// Called by:
/// - `generate_ts.rs` binary (to write the file)
/// - `verify_constants_gen` integration test (to check freshness)
#[must_use]
#[allow(clippy::too_many_lines)] // TS codegen is linear and clear despite length
pub fn generate_constants_ts() -> String {
    use std::fmt::Write;

    let mut out = String::new();

    writeln!(
        out,
        "// AUTO-GENERATED by compute-wire/src/bin/generate_ts.rs"
    )
    .unwrap();
    writeln!(out, "// Do not edit manually. Regenerate with:").unwrap();
    writeln!(out, "//   cargo run -p compute-wire --bin generate-ts > kernel/src/bridges/wire/constants.gen.ts").unwrap();
    writeln!(out, "//").unwrap();
    writeln!(out, "// Source of truth: compute-core/crates/compute-wire/src/{{constants,flags}}.rs, domain-types/src/cell_format.rs").unwrap();
    writeln!(out).unwrap();

    writeln!(
        out,
        "// ---------------------------------------------------------------------------"
    )
    .unwrap();
    writeln!(out, "// Wire format layout constants").unwrap();
    writeln!(
        out,
        "// ---------------------------------------------------------------------------"
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "/** Wire protocol version — must match Rust WIRE_VERSION. */"
    )
    .unwrap();
    writeln!(
        out,
        "export const WIRE_VERSION = {};",
        constants::WIRE_VERSION
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(out, "/** Viewport header size in bytes. */").unwrap();
    writeln!(
        out,
        "export const HEADER_SIZE = {};",
        constants::VIEWPORT_HEADER_SIZE
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(out, "/** Size of a single cell record (bytes). */").unwrap();
    writeln!(
        out,
        "export const CELL_STRIDE = {};",
        constants::CELL_STRIDE
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(out, "/** Size of a merge record (bytes). */").unwrap();
    writeln!(
        out,
        "export const MERGE_STRIDE = {};",
        constants::MERGE_STRIDE
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(out, "/** Size of a dimension record (bytes). */").unwrap();
    writeln!(out, "export const DIM_STRIDE = {};", constants::DIM_STRIDE).unwrap();
    writeln!(out).unwrap();
    writeln!(out, "/** Sentinel for 'no string' in u32 offset fields. */").unwrap();
    writeln!(
        out,
        "export const NO_STRING = 0x{:08x};",
        constants::NO_STRING
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(out, "/** Mutation header size in bytes. */").unwrap();
    writeln!(
        out,
        "export const MUTATION_HEADER_SIZE = {};",
        constants::MUTATION_HEADER_SIZE
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "/** Mutation cell patch size (row + col + cell record). */"
    )
    .unwrap();
    writeln!(
        out,
        "export const PATCH_STRIDE = {};",
        constants::PATCH_STRIDE
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "// ---------------------------------------------------------------------------"
    )
    .unwrap();
    writeln!(
        out,
        "// Cell record byte offsets (within each 32-byte cell record)"
    )
    .unwrap();
    writeln!(
        out,
        "// ---------------------------------------------------------------------------"
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "export const OFF_NUMBER_VALUE = {};",
        constants::OFF_NUMBER_VALUE
    )
    .unwrap();
    writeln!(
        out,
        "export const OFF_DISPLAY_OFF = {};",
        constants::OFF_DISPLAY_OFF
    )
    .unwrap();
    writeln!(
        out,
        "export const OFF_ERROR_OFF = {};",
        constants::OFF_ERROR_OFF
    )
    .unwrap();
    writeln!(out, "export const OFF_FLAGS = {};", constants::OFF_FLAGS).unwrap();
    writeln!(
        out,
        "export const OFF_FORMAT_IDX = {};",
        constants::OFF_FORMAT_IDX
    )
    .unwrap();
    writeln!(
        out,
        "export const OFF_DISPLAY_LEN = {};",
        constants::OFF_DISPLAY_LEN
    )
    .unwrap();
    writeln!(
        out,
        "export const OFF_ERROR_LEN = {};",
        constants::OFF_ERROR_LEN
    )
    .unwrap();
    writeln!(
        out,
        "export const OFF_BG_COLOR_OVERRIDE = {};",
        constants::OFF_BG_COLOR_OVERRIDE
    )
    .unwrap();
    writeln!(
        out,
        "export const OFF_FONT_COLOR_OVERRIDE = {};",
        constants::OFF_FONT_COLOR_OVERRIDE
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "/** Size of a data bar entry in CF extras section (bytes). */"
    )
    .unwrap();
    writeln!(
        out,
        "export const DATA_BAR_ENTRY_STRIDE = {};",
        constants::DATA_BAR_ENTRY_STRIDE
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "/** Size of an icon entry in CF extras section (bytes). */"
    )
    .unwrap();
    writeln!(
        out,
        "export const ICON_ENTRY_STRIDE = {};",
        constants::ICON_ENTRY_STRIDE
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(out, "/** Size of a position entry (f64) in bytes. */").unwrap();
    writeln!(
        out,
        "export const POSITION_ENTRY_SIZE = {};",
        constants::POSITION_ENTRY_SIZE
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "// ---------------------------------------------------------------------------"
    )
    .unwrap();
    writeln!(out, "// Flag bit definitions (cell flags u16 bitfield)").unwrap();
    writeln!(
        out,
        "// ---------------------------------------------------------------------------"
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "export const VALUE_TYPE_MASK = 0x{:x};",
        flags::VALUE_TYPE_MASK
    )
    .unwrap();
    writeln!(
        out,
        "export const VALUE_TYPE_NULL = {};",
        flags::VALUE_TYPE_NULL
    )
    .unwrap();
    writeln!(
        out,
        "export const VALUE_TYPE_NUMBER = {};",
        flags::VALUE_TYPE_NUMBER
    )
    .unwrap();
    writeln!(
        out,
        "export const VALUE_TYPE_TEXT = {};",
        flags::VALUE_TYPE_TEXT
    )
    .unwrap();
    writeln!(
        out,
        "export const VALUE_TYPE_BOOL = {};",
        flags::VALUE_TYPE_BOOL
    )
    .unwrap();
    writeln!(
        out,
        "export const VALUE_TYPE_ERROR = {};",
        flags::VALUE_TYPE_ERROR
    )
    .unwrap();
    writeln!(
        out,
        "export const VALUE_TYPE_IMAGE = {};",
        flags::VALUE_TYPE_IMAGE
    )
    .unwrap();
    writeln!(
        out,
        "export const HAS_FORMULA = 0x{:x};",
        flags::HAS_FORMULA
    )
    .unwrap();
    writeln!(
        out,
        "export const HAS_COMMENT = 0x{:x};",
        flags::HAS_COMMENT
    )
    .unwrap();
    writeln!(
        out,
        "export const HAS_SPARKLINE = 0x{:x};",
        flags::HAS_SPARKLINE
    )
    .unwrap();
    writeln!(
        out,
        "export const HAS_HYPERLINK = 0x{:x};",
        flags::HAS_HYPERLINK
    )
    .unwrap();
    writeln!(
        out,
        "export const IS_CHECKBOX = 0x{:x};",
        flags::IS_CHECKBOX
    )
    .unwrap();
    writeln!(
        out,
        "export const IS_SPILL_MEMBER = 0x{:x};",
        flags::IS_SPILL_MEMBER
    )
    .unwrap();
    writeln!(
        out,
        "export const HAS_VALIDATION_ERROR = 0x{:x};",
        flags::HAS_VALIDATION_ERROR
    )
    .unwrap();
    writeln!(
        out,
        "export const HAS_CF_EXTRAS = 0x{:x};",
        flags::HAS_CF_EXTRAS
    )
    .unwrap();
    writeln!(
        out,
        "export const HAS_CELL_IMAGE = 0x{:x};",
        flags::HAS_CELL_IMAGE
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "/** Value type enum (convenience wrapper over flag bits 0-2). */"
    )
    .unwrap();
    writeln!(out, "export enum ValueType {{").unwrap();
    writeln!(out, "  Null = {},", flags::VALUE_TYPE_NULL).unwrap();
    writeln!(out, "  Number = {},", flags::VALUE_TYPE_NUMBER).unwrap();
    writeln!(out, "  Text = {},", flags::VALUE_TYPE_TEXT).unwrap();
    writeln!(out, "  Bool = {},", flags::VALUE_TYPE_BOOL).unwrap();
    writeln!(out, "  Error = {},", flags::VALUE_TYPE_ERROR).unwrap();
    writeln!(out, "  Image = {},", flags::VALUE_TYPE_IMAGE).unwrap();
    writeln!(out, "}}").unwrap();
    writeln!(out).unwrap();

    writeln!(
        out,
        "// ---------------------------------------------------------------------------"
    )
    .unwrap();
    writeln!(
        out,
        "// Mutation header flags (u8 bitfield at header offset 10)"
    )
    .unwrap();
    writeln!(
        out,
        "// ---------------------------------------------------------------------------"
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "/** Bit 0: mutation contains projection (spill) changes. */"
    )
    .unwrap();
    writeln!(
        out,
        "export const MUT_HAS_PROJECTION_CHANGES = 0x{:02x};",
        flags::MUT_HAS_PROJECTION_CHANGES
    )
    .unwrap();
    writeln!(out, "/** Bit 1: mutation contains cell errors. */").unwrap();
    writeln!(
        out,
        "export const MUT_HAS_ERRORS = 0x{:02x};",
        flags::MUT_HAS_ERRORS
    )
    .unwrap();
    writeln!(
        out,
        "/** Bit 2: mutation contains a format palette delta. */"
    )
    .unwrap();
    writeln!(
        out,
        "export const MUT_HAS_PALETTE = 0x{:02x};",
        flags::MUT_HAS_PALETTE
    )
    .unwrap();
    writeln!(out).unwrap();

    // Icon set names
    writeln!(
        out,
        "// ---------------------------------------------------------------------------"
    )
    .unwrap();
    writeln!(
        out,
        "// Icon set names (matches CFIconSetName enum discriminant order)"
    )
    .unwrap();
    writeln!(
        out,
        "// ---------------------------------------------------------------------------"
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(out, "/**").unwrap();
    writeln!(
        out,
        " * Icon set names — derived from Rust CFIconSetName::SERDE_NAMES."
    )
    .unwrap();
    writeln!(
        out,
        " * Source of truth: compute-cf/src/types/enums.rs `CFIconSetName::SERDE_NAMES`."
    )
    .unwrap();
    writeln!(out, " */").unwrap();

    let icon_set_names = compute_cf::types::CFIconSetName::SERDE_NAMES;

    writeln!(out, "export const ICON_SET_NAMES: readonly string[] = [").unwrap();
    for name in icon_set_names {
        writeln!(out, "  '{name}',").unwrap();
    }
    writeln!(out, "];").unwrap();
    writeln!(out).unwrap();

    // Palette binary section constants
    writeln!(
        out,
        "// ---------------------------------------------------------------------------"
    )
    .unwrap();
    writeln!(out, "// Palette binary format constants").unwrap();
    writeln!(
        out,
        "// ---------------------------------------------------------------------------"
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "/** Palette section header size: u16 start_index + u16 format_count + u32 string_pool_bytes. */"
    )
    .unwrap();
    writeln!(
        out,
        "export const PALETTE_HEADER_SIZE = {};",
        constants::PALETTE_HEADER_SIZE
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(
        out,
        "/** Size of a string reference in the palette: u32 offset + u16 length. */"
    )
    .unwrap();
    writeln!(
        out,
        "export const PALETTE_STR_REF_SIZE = {};",
        constants::PALETTE_STR_REF_SIZE
    )
    .unwrap();
    writeln!(out).unwrap();

    // Palette presence mask bit constants
    writeln!(
        out,
        "/** Palette format record presence mask bit constants. */"
    )
    .unwrap();
    {
        use palette_binary::{
            BIT_BACKGROUND_COLOR, BIT_BOLD, BIT_BORDERS, BIT_FONT_CHARSET, BIT_FONT_COLOR,
            BIT_FONT_FAMILY, BIT_FONT_FAMILY_TYPE, BIT_FONT_OUTLINE, BIT_FONT_SHADOW,
            BIT_FONT_SIZE, BIT_FONT_THEME, BIT_GRADIENT_FILL, BIT_HIDDEN, BIT_HORIZONTAL_ALIGN,
            BIT_INDENT, BIT_ITALIC, BIT_LOCKED, BIT_NUMBER_FORMAT, BIT_PATTERN_FG_COLOR,
            BIT_PATTERN_TYPE, BIT_READING_ORDER, BIT_SHRINK_TO_FIT, BIT_STRIKETHROUGH,
            BIT_SUBSCRIPT, BIT_SUPERSCRIPT, BIT_TEXT_ROTATION, BIT_UNDERLINE_TYPE,
            BIT_VERTICAL_ALIGN, BIT_WRAP_TEXT,
        };
        let bits: &[(&str, u32)] = &[
            ("BIT_FONT_FAMILY", BIT_FONT_FAMILY),
            ("BIT_FONT_SIZE", BIT_FONT_SIZE),
            ("BIT_FONT_COLOR", BIT_FONT_COLOR),
            ("BIT_BOLD", BIT_BOLD),
            ("BIT_ITALIC", BIT_ITALIC),
            ("BIT_UNDERLINE_TYPE", BIT_UNDERLINE_TYPE),
            ("BIT_STRIKETHROUGH", BIT_STRIKETHROUGH),
            ("BIT_SUPERSCRIPT", BIT_SUPERSCRIPT),
            ("BIT_SUBSCRIPT", BIT_SUBSCRIPT),
            ("BIT_FONT_OUTLINE", BIT_FONT_OUTLINE),
            ("BIT_FONT_SHADOW", BIT_FONT_SHADOW),
            ("BIT_FONT_THEME", BIT_FONT_THEME),
            ("BIT_FONT_CHARSET", BIT_FONT_CHARSET),
            ("BIT_FONT_FAMILY_TYPE", BIT_FONT_FAMILY_TYPE),
            ("BIT_HORIZONTAL_ALIGN", BIT_HORIZONTAL_ALIGN),
            ("BIT_VERTICAL_ALIGN", BIT_VERTICAL_ALIGN),
            ("BIT_WRAP_TEXT", BIT_WRAP_TEXT),
            ("BIT_INDENT", BIT_INDENT),
            ("BIT_TEXT_ROTATION", BIT_TEXT_ROTATION),
            ("BIT_SHRINK_TO_FIT", BIT_SHRINK_TO_FIT),
            ("BIT_READING_ORDER", BIT_READING_ORDER),
            ("BIT_NUMBER_FORMAT", BIT_NUMBER_FORMAT),
            ("BIT_BACKGROUND_COLOR", BIT_BACKGROUND_COLOR),
            ("BIT_PATTERN_TYPE", BIT_PATTERN_TYPE),
            ("BIT_PATTERN_FG_COLOR", BIT_PATTERN_FG_COLOR),
            ("BIT_GRADIENT_FILL", BIT_GRADIENT_FILL),
            ("BIT_BORDERS", BIT_BORDERS),
            ("BIT_LOCKED", BIT_LOCKED),
            ("BIT_HIDDEN", BIT_HIDDEN),
        ];
        for (name, val) in bits {
            writeln!(out, "export const {name} = 0x{val:08x};").unwrap();
        }
    }
    writeln!(out).unwrap();

    // CellFormat field names
    let fields = cell_format_json_fields();
    writeln!(
        out,
        "// ---------------------------------------------------------------------------"
    )
    .unwrap();
    writeln!(
        out,
        "// CellFormat field names (Rust source of truth for drift detection)"
    )
    .unwrap();
    writeln!(
        out,
        "// ---------------------------------------------------------------------------"
    )
    .unwrap();
    writeln!(out, "//").unwrap();
    writeln!(
        out,
        "// These are the camelCase JSON field names produced by serializing the Rust"
    )
    .unwrap();
    writeln!(
        out,
        "// CellFormat struct. A TS test compares these against the hand-maintained"
    )
    .unwrap();
    writeln!(
        out,
        "// CellFormat interface in @mog-sdk/spreadsheet-contracts to catch field drift."
    )
    .unwrap();
    writeln!(out).unwrap();
    writeln!(out, "export const RUST_CELL_FORMAT_FIELDS = [").unwrap();
    for field in &fields {
        writeln!(out, "  '{field}',").unwrap();
    }
    writeln!(out, "] as const;").unwrap();

    out
}

// Re-export key items at crate root for convenience
pub use constants::*;
pub use flags::*;
pub use mutation::CfColorOverrides;
pub use mutation::serialize_multi_viewport_patches;
pub use mutation::serialize_mutation_result;
pub use mutation::serialize_mutation_result_for_viewport;
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
            "quotePrefix",
            "readingOrder",
            "textRotation",
            "shrinkToFit",
            "strikethrough",
            "subscript",
            "superscript",
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
