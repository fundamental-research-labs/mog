use std::sync::Arc;

use domain_types::yrs_schema;
use domain_types::{SheetData, ThemeData};
use yrs::{Any, Map, MapRef};

use crate::storage::infra::hydration::view::{
    hydrate_frozen_pane, hydrate_hf_images, hydrate_page_breaks, hydrate_print_settings,
    hydrate_sheet_protection, hydrate_view_options,
};

pub(crate) fn sheet_color_to_hex(
    color: &ooxml_types::styles::ColorDef,
    theme: Option<&ThemeData>,
    indexed_colors: Option<&ooxml_types::styles::ColorsDef>,
) -> Option<String> {
    let (base_hex, tint) = match color {
        ooxml_types::styles::ColorDef::Rgb { val, tint } => {
            (normalize_rgb_hex(val)?, parse_tint(tint.as_deref()))
        }
        ooxml_types::styles::ColorDef::Theme { id, tint } => {
            let theme = theme?;
            (
                resolve_theme_color(theme, *id)?,
                parse_tint(tint.as_deref()),
            )
        }
        ooxml_types::styles::ColorDef::Indexed { id, tint } => (
            resolve_indexed_color(*id, indexed_colors)?,
            parse_tint(tint.as_deref()),
        ),
        ooxml_types::styles::ColorDef::Auto { tint } => {
            ("#000000".to_string(), parse_tint(tint.as_deref()))
        }
    };

    Some(match tint {
        Some(tint) => domain_types::theme_color::apply_tint(&base_hex, tint),
        None => base_hex,
    })
}

fn normalize_rgb_hex(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let trimmed = trimmed.strip_prefix('#').unwrap_or(trimmed);
    let bytes = trimmed.as_bytes();
    let rgb = match bytes.len() {
        8 => bytes.get(2..)?,
        6 => bytes,
        _ => return None,
    };
    if !rgb.iter().all(u8::is_ascii_hexdigit) {
        return None;
    }
    let rgb = std::str::from_utf8(rgb).ok()?;
    Some(format!("#{}", rgb.to_ascii_uppercase()))
}

fn parse_tint(tint: Option<&str>) -> Option<f64> {
    tint.and_then(|value| value.parse::<f64>().ok())
        .filter(|value| *value != 0.0)
}

fn resolve_theme_color(theme: &ThemeData, theme_id: u32) -> Option<String> {
    let scheme_index = theme_color_index_to_scheme_index(theme_id)?;
    if let Some(color_scheme) = theme.color_scheme.as_ref()
        && let Some(hex) = color_scheme.resolve_hex(scheme_index)
    {
        return normalize_rgb_hex(&hex);
    }

    let names = theme_scheme_slot_names(scheme_index);
    theme
        .colors
        .iter()
        .find(|color| names.iter().any(|name| color.name == *name))
        .and_then(|color| normalize_rgb_hex(&color.color))
}

fn theme_color_index_to_scheme_index(theme_id: u32) -> Option<u8> {
    match theme_id {
        0 => Some(1),
        1 => Some(0),
        2 => Some(3),
        3 => Some(2),
        4..=11 => Some(theme_id as u8),
        _ => None,
    }
}

fn theme_scheme_slot_names(scheme_index: u8) -> &'static [&'static str] {
    match scheme_index {
        0 => &["dk1", "dark1"],
        1 => &["lt1", "light1"],
        2 => &["dk2", "dark2"],
        3 => &["lt2", "light2"],
        4 => &["accent1"],
        5 => &["accent2"],
        6 => &["accent3"],
        7 => &["accent4"],
        8 => &["accent5"],
        9 => &["accent6"],
        10 => &["hlink", "hyperlink"],
        11 => &["folHlink", "followedHyperlink"],
        _ => &[],
    }
}

fn resolve_indexed_color(
    id: u32,
    indexed_colors: Option<&ooxml_types::styles::ColorsDef>,
) -> Option<String> {
    indexed_colors
        .and_then(|colors| colors.indexed_colors.get(id as usize))
        .and_then(|color| normalize_rgb_hex(color))
        .or_else(|| ooxml_types::styles::ColorDef::indexed(id).to_argb())
        .and_then(|color| normalize_rgb_hex(&color))
}

pub(crate) fn insert_sheet_properties_metadata(
    txn: &mut yrs::TransactionMut,
    meta_map: &MapRef,
    properties: &ooxml_types::worksheet::SheetProperties,
    theme: Option<&ThemeData>,
    indexed_colors: Option<&ooxml_types::styles::ColorsDef>,
) {
    yrs_schema::sheet_properties::insert(txn, meta_map, properties);
    if let Some(color) = properties
        .tab_color
        .as_ref()
        .and_then(|color| sheet_color_to_hex(color, theme, indexed_colors))
    {
        meta_map.insert(txn, "tabColor", Any::String(Arc::from(color.as_str())));
    }
}

pub(crate) fn hydrate_sheet_view_metadata(
    txn: &mut yrs::TransactionMut,
    meta_map: &MapRef,
    sheet: &SheetData,
    write_sheet_properties: bool,
    theme: Option<&ThemeData>,
    indexed_colors: Option<&ooxml_types::styles::ColorsDef>,
) {
    hydrate_frozen_pane(txn, meta_map, &sheet.frozen_pane);
    hydrate_view_options(txn, meta_map, &sheet.view);
    hydrate_sheet_protection(txn, meta_map, &sheet.protection);
    hydrate_print_settings(txn, meta_map, &sheet.print_settings);
    hydrate_hf_images(txn, meta_map, &sheet.hf_images);
    hydrate_page_breaks(txn, meta_map, &sheet.page_breaks);

    yrs_schema::helpers::write_json_vec(meta_map, txn, "extraSheetViews", &sheet.extra_sheet_views);
    if let Some(xml) = sheet
        .sheet_views_ext_lst_xml
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        meta_map.insert(txn, "sheetViewsExtLstXml", Any::String(Arc::from(xml)));
    }

    if let Some(ref uid) = sheet.uid {
        meta_map.insert(txn, "sheetUid", Any::String(Arc::from(uid.as_str())));
    }
    if write_sheet_properties && let Some(properties) = &sheet.sheet_properties {
        insert_sheet_properties_metadata(txn, meta_map, properties, theme, indexed_colors);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use domain_types::{ThemeColor, ThemeData};
    use ooxml_types::styles::{ColorDef, ColorsDef};
    use ooxml_types::themes::ColorScheme;

    #[test]
    fn sheet_color_to_hex_resolves_all_ooxml_color_variants() {
        let theme = ThemeData {
            color_scheme: Some(ColorScheme::office_default()),
            ..Default::default()
        };
        let indexed_colors = ColorsDef {
            indexed_colors: vec![
                "FF000000".to_string(),
                "FFFFFFFF".to_string(),
                "FF00AA00".to_string(),
            ],
            ..Default::default()
        };

        assert_eq!(
            sheet_color_to_hex(&ColorDef::rgb("FFFF0000"), None, None).as_deref(),
            Some("#FF0000")
        );
        assert_eq!(
            sheet_color_to_hex(&ColorDef::theme(4), Some(&theme), None).as_deref(),
            Some("#4472C4")
        );
        assert_eq!(
            sheet_color_to_hex(&ColorDef::theme(0), Some(&theme), None).as_deref(),
            Some("#FFFFFF")
        );
        assert_eq!(
            sheet_color_to_hex(&ColorDef::indexed(2), None, Some(&indexed_colors)).as_deref(),
            Some("#00AA00")
        );
        assert_eq!(
            sheet_color_to_hex(&ColorDef::indexed(3), None, None).as_deref(),
            Some("#00FF00")
        );
        assert_eq!(
            sheet_color_to_hex(&ColorDef::auto(), None, None).as_deref(),
            Some("#000000")
        );
    }

    #[test]
    fn sheet_color_to_hex_applies_tint_to_runtime_color() {
        let color = ColorDef::rgb_with_tint("FF4472C4", "0.5");
        let expected = domain_types::theme_color::apply_tint("#4472C4", 0.5);

        assert_eq!(
            sheet_color_to_hex(&color, None, None).as_deref(),
            Some(expected.as_str())
        );
    }

    #[test]
    fn sheet_color_to_hex_can_use_theme_color_projection_without_full_scheme() {
        let theme = ThemeData {
            colors: vec![ThemeColor {
                name: "accent2".to_string(),
                color: "#ED7D31".to_string(),
                source: None,
            }],
            ..Default::default()
        };

        assert_eq!(
            sheet_color_to_hex(&ColorDef::theme(5), Some(&theme), None).as_deref(),
            Some("#ED7D31")
        );
    }
}
