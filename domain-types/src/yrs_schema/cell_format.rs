//! Yrs schema for [`CellFormat`] — flat Y.Map with 28 optional fields.
//!
//! Used for row-level and column-level format overrides stored in Yrs.
//! Each field maps to a short key to save storage space.

use std::sync::Arc;
use yrs::types::map::MapRef;
use yrs::{Any, Map, ReadTxn, TransactionMut};

use super::helpers::*;
use crate::{CellFormat, CellVerticalAlign};
use ooxml_types::styles::{HorizontalAlign, PatternType, UnderlineStyle};

// ---- Short key constants (2-char mnemonics) --------------------------------

pub const KEY_FONT_FAMILY: &str = "ff";
pub const KEY_FONT_SIZE: &str = "fs";
pub const KEY_FONT_COLOR: &str = "fc";
pub const KEY_BOLD: &str = "bo";
pub const KEY_ITALIC: &str = "it";
pub const KEY_UNDERLINE_TYPE: &str = "ul";
pub const KEY_STRIKETHROUGH: &str = "st";
pub const KEY_HORIZONTAL_ALIGN: &str = "ha";
pub const KEY_VERTICAL_ALIGN: &str = "va";
pub const KEY_WRAP_TEXT: &str = "wt";
pub const KEY_NUMBER_FORMAT: &str = "nf";
pub const KEY_BACKGROUND_COLOR: &str = "bg";
pub const KEY_LOCKED: &str = "lk";
pub const KEY_HIDDEN: &str = "hd";
pub const KEY_INDENT: &str = "in";
pub const KEY_ROTATION: &str = "ro";
pub const KEY_XLSX_STYLE_ID: &str = "xi";
pub const KEY_SUPERSCRIPT: &str = "ss";
pub const KEY_SUBSCRIPT: &str = "sb";
pub const KEY_SHRINK_TO_FIT: &str = "sf";
pub const KEY_READING_ORDER: &str = "rd";
pub const KEY_FONT_THEME: &str = "ft";
pub const KEY_PATTERN_TYPE: &str = "pt";
pub const KEY_PATTERN_FG_COLOR: &str = "pf";
pub const KEY_FONT_OUTLINE: &str = "fo";
pub const KEY_FONT_SHADOW: &str = "fw";
pub const KEY_QUOTE_PREFIX: &str = "qp";
pub const KEY_FONT_CHARSET: &str = "cs";
pub const KEY_FONT_FAMILY_TYPE: &str = "fy";
pub const KEY_AUTO_INDENT: &str = "ai";
pub const KEY_FONT_COLOR_TINT: &str = "fct";
pub const KEY_BG_COLOR_TINT: &str = "bct";
pub const KEY_PATTERN_FG_COLOR_TINT: &str = "pfct";

/// Convert a [`CellFormat`] to Yrs prelim entries for initial hydration.
///
/// Only present (Some) fields are emitted — omitted fields produce no key,
/// keeping the Y.Map sparse and bandwidth-friendly.
pub fn to_yrs_prelim(fmt: &CellFormat) -> Vec<(&str, Any)> {
    let mut entries: Vec<(&str, Any)> = Vec::with_capacity(32);

    if let Some(ref v) = fmt.font_family {
        entries.push((KEY_FONT_FAMILY, Any::String(Arc::from(v.as_str()))));
    }
    if let Some(v) = fmt.font_size {
        entries.push((KEY_FONT_SIZE, Any::Number(v.millipoints() as f64)));
    }
    if let Some(ref v) = fmt.font_color {
        entries.push((KEY_FONT_COLOR, Any::String(Arc::from(v.as_str()))));
    }
    if let Some(v) = fmt.font_color_tint {
        entries.push((KEY_FONT_COLOR_TINT, Any::Number(v)));
    }
    if let Some(v) = fmt.bold {
        entries.push((KEY_BOLD, Any::Bool(v)));
    }
    if let Some(v) = fmt.italic {
        entries.push((KEY_ITALIC, Any::Bool(v)));
    }
    if let Some(v) = fmt.underline_type {
        entries.push((KEY_UNDERLINE_TYPE, Any::String(Arc::from(v.to_ooxml()))));
    }
    if let Some(v) = fmt.strikethrough {
        entries.push((KEY_STRIKETHROUGH, Any::Bool(v)));
    }
    if let Some(v) = fmt.horizontal_align {
        entries.push((KEY_HORIZONTAL_ALIGN, Any::String(Arc::from(v.to_ooxml()))));
    }
    if let Some(v) = fmt.vertical_align {
        entries.push((
            KEY_VERTICAL_ALIGN,
            Any::String(Arc::from(v.to_kernel_token())),
        ));
    }
    if let Some(v) = fmt.wrap_text {
        entries.push((KEY_WRAP_TEXT, Any::Bool(v)));
    }
    if let Some(ref v) = fmt.number_format {
        entries.push((KEY_NUMBER_FORMAT, Any::String(Arc::from(v.as_str()))));
    }
    if let Some(ref v) = fmt.background_color {
        entries.push((KEY_BACKGROUND_COLOR, Any::String(Arc::from(v.as_str()))));
    }
    if let Some(v) = fmt.background_color_tint {
        entries.push((KEY_BG_COLOR_TINT, Any::Number(v)));
    }
    if let Some(v) = fmt.locked {
        entries.push((KEY_LOCKED, Any::Bool(v)));
    }
    if let Some(v) = fmt.hidden {
        entries.push((KEY_HIDDEN, Any::Bool(v)));
    }
    if let Some(v) = fmt.indent {
        entries.push((KEY_INDENT, Any::Number(v as f64)));
    }
    if let Some(v) = fmt.text_rotation {
        entries.push((KEY_ROTATION, Any::Number(v as f64)));
    }
    if let Some(v) = fmt.superscript {
        entries.push((KEY_SUPERSCRIPT, Any::Bool(v)));
    }
    if let Some(v) = fmt.subscript {
        entries.push((KEY_SUBSCRIPT, Any::Bool(v)));
    }
    if let Some(v) = fmt.font_outline {
        entries.push((KEY_FONT_OUTLINE, Any::Bool(v)));
    }
    if let Some(v) = fmt.font_shadow {
        entries.push((KEY_FONT_SHADOW, Any::Bool(v)));
    }
    if let Some(ref v) = fmt.font_theme {
        entries.push((KEY_FONT_THEME, Any::String(Arc::from(v.as_str()))));
    }
    if let Some(v) = fmt.font_charset {
        entries.push((KEY_FONT_CHARSET, Any::Number(v as f64)));
    }
    if let Some(v) = fmt.font_family_type {
        entries.push((KEY_FONT_FAMILY_TYPE, Any::Number(v as f64)));
    }
    if let Some(v) = fmt.shrink_to_fit {
        entries.push((KEY_SHRINK_TO_FIT, Any::Bool(v)));
    }
    if let Some(ref v) = fmt.reading_order {
        entries.push((KEY_READING_ORDER, Any::String(Arc::from(v.as_str()))));
    }
    if let Some(v) = fmt.auto_indent {
        entries.push((KEY_AUTO_INDENT, Any::Bool(v)));
    }
    if let Some(v) = fmt.pattern_type {
        entries.push((KEY_PATTERN_TYPE, Any::String(Arc::from(v.to_ooxml()))));
    }
    if let Some(ref v) = fmt.pattern_foreground_color {
        entries.push((KEY_PATTERN_FG_COLOR, Any::String(Arc::from(v.as_str()))));
    }
    if let Some(v) = fmt.pattern_foreground_color_tint {
        entries.push((KEY_PATTERN_FG_COLOR_TINT, Any::Number(v)));
    }
    if let Some(v) = fmt.quote_prefix {
        entries.push((KEY_QUOTE_PREFIX, Any::Bool(v)));
    }

    entries
}

/// Read a [`CellFormat`] from a Y.Map with structured fields.
///
/// Returns `None` only if the map has zero recognized keys (completely empty).
/// A map with at least one recognized field returns `Some(CellFormat { ... })`.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<CellFormat> {
    let fmt = CellFormat {
        font_family: read_string(map, txn, KEY_FONT_FAMILY),
        font_size: read_u32(map, txn, KEY_FONT_SIZE).map(crate::FontSize::from_millipoints),
        font_color: read_string(map, txn, KEY_FONT_COLOR),
        font_color_tint: read_number(map, txn, KEY_FONT_COLOR_TINT),
        bold: read_bool(map, txn, KEY_BOLD),
        italic: read_bool(map, txn, KEY_ITALIC),
        underline_type: read_string(map, txn, KEY_UNDERLINE_TYPE).and_then(|s| {
            parse_ooxml_token(&s, KEY_UNDERLINE_TYPE, UnderlineStyle::from_ooxml_token)
        }),
        strikethrough: read_bool(map, txn, KEY_STRIKETHROUGH),
        horizontal_align: read_string(map, txn, KEY_HORIZONTAL_ALIGN).and_then(|s| {
            parse_ooxml_token(&s, KEY_HORIZONTAL_ALIGN, HorizontalAlign::from_ooxml_token)
        }),
        vertical_align: read_string(map, txn, KEY_VERTICAL_ALIGN).and_then(|s| {
            parse_ooxml_token(&s, KEY_VERTICAL_ALIGN, CellVerticalAlign::from_kernel_token)
        }),
        wrap_text: read_bool(map, txn, KEY_WRAP_TEXT),
        number_format: read_string(map, txn, KEY_NUMBER_FORMAT),
        background_color: read_string(map, txn, KEY_BACKGROUND_COLOR),
        background_color_tint: read_number(map, txn, KEY_BG_COLOR_TINT),
        locked: read_bool(map, txn, KEY_LOCKED),
        hidden: read_bool(map, txn, KEY_HIDDEN),
        indent: read_u32(map, txn, KEY_INDENT),
        text_rotation: read_i32(map, txn, KEY_ROTATION),
        superscript: read_bool(map, txn, KEY_SUPERSCRIPT),
        subscript: read_bool(map, txn, KEY_SUBSCRIPT),
        font_outline: read_bool(map, txn, KEY_FONT_OUTLINE),
        font_shadow: read_bool(map, txn, KEY_FONT_SHADOW),
        font_theme: read_string(map, txn, KEY_FONT_THEME),
        font_charset: read_u32(map, txn, KEY_FONT_CHARSET),
        font_family_type: read_u32(map, txn, KEY_FONT_FAMILY_TYPE),
        shrink_to_fit: read_bool(map, txn, KEY_SHRINK_TO_FIT),
        reading_order: read_string(map, txn, KEY_READING_ORDER),
        auto_indent: read_bool(map, txn, KEY_AUTO_INDENT),
        pattern_type: read_string(map, txn, KEY_PATTERN_TYPE)
            .and_then(|s| parse_ooxml_token(&s, KEY_PATTERN_TYPE, PatternType::from_ooxml_token)),
        pattern_foreground_color: read_string(map, txn, KEY_PATTERN_FG_COLOR),
        pattern_foreground_color_tint: read_number(map, txn, KEY_PATTERN_FG_COLOR_TINT),
        quote_prefix: read_bool(map, txn, KEY_QUOTE_PREFIX),
        // borders not stored in row/col Y.Maps (cell-level only via CellProperties JSON)
        ..Default::default()
    };

    // Return None if every field is None (empty map).
    if fmt == CellFormat::default() {
        return None;
    }
    Some(fmt)
}

/// Update a single field on an existing CellFormat Y.Map.
pub fn update_field(map: &MapRef, txn: &mut TransactionMut, key: &str, value: Any) {
    map.insert(txn, key, value);
}

/// Write all fields of a [`CellFormat`] into an existing Y.Map.
///
/// Used by runtime `set_row_format` / `set_col_format` to write structured
/// fields into an already-existing Y.Map entry.
pub fn write_to_map(map: &MapRef, txn: &mut TransactionMut, fmt: &CellFormat) {
    for (key, value) in to_yrs_prelim(fmt) {
        map.insert(txn, key, value);
    }
}

#[cfg(test)]
mod tests {
    //! Round-trip tests for the W-styles typed enum fields.
    //!
    //! These tests guarantee that:
    //!   * Yrs write/read preserves the typed enum value.
    //!   * The Yrs on-disk representation is an OOXML token string (byte-identical
    //!     to the pre-Round-D `Option<String>` wire format).
    //!   * JSON serde round-trip preserves the typed enum value and uses the
    //!     OOXML token on the wire.
    use super::*;
    use ooxml_types::styles::{BorderStyle, HorizontalAlign, PatternType, UnderlineStyle};
    use yrs::{Doc, Map, Transact};

    fn yrs_roundtrip(fmt: &CellFormat) -> CellFormat {
        let doc = Doc::new();
        let map = doc.get_or_insert_map("fmt");
        {
            let mut txn = doc.transact_mut();
            for (key, value) in to_yrs_prelim(fmt) {
                map.insert(&mut txn, key, value);
            }
        }
        let txn = doc.transact();
        from_yrs_map(&map, &txn).expect("non-empty CellFormat should read back")
    }

    #[test]
    fn typed_enum_fields_yrs_roundtrip() {
        let fmt = CellFormat {
            underline_type: Some(UnderlineStyle::DoubleAccounting),
            horizontal_align: Some(HorizontalAlign::CenterContinuous),
            vertical_align: Some(CellVerticalAlign::Middle),
            pattern_type: Some(PatternType::Gray125),
            ..Default::default()
        };
        let rt = yrs_roundtrip(&fmt);
        assert_eq!(rt.underline_type, Some(UnderlineStyle::DoubleAccounting));
        assert_eq!(rt.horizontal_align, Some(HorizontalAlign::CenterContinuous));
        assert_eq!(rt.vertical_align, Some(CellVerticalAlign::Middle));
        assert_eq!(rt.pattern_type, Some(PatternType::Gray125));
    }

    #[test]
    fn yrs_on_disk_shape_is_ooxml_token() {
        // Yrs stores the enum as an OOXML string token -- byte-identical to the
        // pre-Round-D `Option<String>` wire format.
        let fmt = CellFormat {
            horizontal_align: Some(HorizontalAlign::Right),
            vertical_align: Some(CellVerticalAlign::Top),
            underline_type: Some(UnderlineStyle::Single),
            pattern_type: Some(PatternType::Solid),
            ..Default::default()
        };
        let doc = Doc::new();
        let map = doc.get_or_insert_map("fmt");
        {
            let mut txn = doc.transact_mut();
            for (key, value) in to_yrs_prelim(&fmt) {
                map.insert(&mut txn, key, value);
            }
        }
        let txn = doc.transact();
        let get = |k: &str| match map.get(&txn, k) {
            Some(yrs::Out::Any(Any::String(s))) => Some(s.to_string()),
            _ => None,
        };
        assert_eq!(get(KEY_HORIZONTAL_ALIGN), Some("right".to_string()));
        assert_eq!(get(KEY_VERTICAL_ALIGN), Some("top".to_string()));
        assert_eq!(get(KEY_UNDERLINE_TYPE), Some("single".to_string()));
        assert_eq!(get(KEY_PATTERN_TYPE), Some("solid".to_string()));
    }

    #[test]
    fn cell_format_json_roundtrip_ooxml_tokens() {
        // JSON serde must also serialize as OOXML tokens so the API wire format
        // matches the pre-Round-D shape byte-for-byte.
        let fmt = CellFormat {
            horizontal_align: Some(HorizontalAlign::Distributed),
            vertical_align: Some(CellVerticalAlign::Justify),
            underline_type: Some(UnderlineStyle::SingleAccounting),
            pattern_type: Some(PatternType::DarkTrellis),
            borders: Some(crate::CellBorders {
                top: Some(crate::CellBorderSide {
                    style: Some(BorderStyle::MediumDashDot),
                    color: Some("#112233".into()),
                    color_tint: None,
                }),
                ..Default::default()
            }),
            ..Default::default()
        };
        let json = serde_json::to_value(&fmt).unwrap();
        // Verify the wire tokens are OOXML strings.
        assert_eq!(json["horizontalAlign"], "distributed");
        assert_eq!(json["verticalAlign"], "justify");
        assert_eq!(json["underlineType"], "singleAccounting");
        assert_eq!(json["patternType"], "darkTrellis");
        assert_eq!(json["borders"]["top"]["style"], "mediumDashDot");
        // Deserialize back and compare.
        let rt: CellFormat = serde_json::from_value(json).unwrap();
        assert_eq!(rt, fmt);
    }

    #[test]
    fn empty_cell_format_yrs_returns_none() {
        let fmt = CellFormat::default();
        let doc = Doc::new();
        let map = doc.get_or_insert_map("fmt");
        {
            let mut txn = doc.transact_mut();
            for (key, value) in to_yrs_prelim(&fmt) {
                map.insert(&mut txn, key, value);
            }
        }
        let txn = doc.transact();
        assert!(from_yrs_map(&map, &txn).is_none());
    }
}
