use crate::storage::WorkbookStorage;
use domain_types::units::{ImportedNormalFont, LayoutMetrics};

pub(super) fn resolve(storage: &WorkbookStorage, mut metrics: LayoutMetrics) -> LayoutMetrics {
    if !metrics.derive_imported_normal_font {
        return metrics;
    }
    metrics.imported_normal_font = None;
    // Select the actual Normal style, not whichever font appears first.
    let Some(styles) = storage.metadata.stylesheet.as_ref() else {
        return metrics;
    };
    let normal = styles.named_cell_styles.iter().find(|style| {
        style.builtin_id == Some(0)
            || style
                .name
                .as_deref()
                .is_some_and(|name| name.eq_ignore_ascii_case("Normal"))
    });
    let Some(normal) = normal else {
        return metrics;
    };
    let font = styles
        .cell_style_xfs
        .get(normal.xf_id as usize)
        .and_then(|xf| xf.font_id)
        .and_then(|id| styles.fonts.get(id as usize));
    let Some(font) = font else {
        metrics.imported_normal_font = Some(ImportedNormalFont::Unsupported);
        return metrics;
    };
    let theme = storage.metadata.theme.as_ref();
    let name = match font.scheme {
        Some(ooxml_types::styles::FontScheme::Major) => theme.and_then(|t| t.major_font.as_deref()),
        Some(ooxml_types::styles::FontScheme::Minor) => theme.and_then(|t| t.minor_font.as_deref()),
        _ => font.name.as_deref(),
    };
    let profile = if font.bold == Some(true) || font.italic == Some(true) {
        ImportedNormalFont::Unsupported
    } else {
        match (name.map(str::to_ascii_lowercase).as_deref(), font.size) {
            (Some("calibri"), Some(11.0)) => ImportedNormalFont::Calibri11,
            (Some("calibri"), Some(12.0)) => ImportedNormalFont::Calibri12,
            (Some("calibri"), Some(20.0)) => ImportedNormalFont::Calibri20,
            (Some("arial"), Some(11.0)) => ImportedNormalFont::Arial11,
            _ => ImportedNormalFont::Unsupported,
        }
    };
    metrics.imported_normal_font = Some(profile);
    metrics
}
