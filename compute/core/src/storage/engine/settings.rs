/// Shared read-only settings used during viewport rendering, formatting, and queries.
///
/// These fields are derived from the workbook's stored culture and theme properties
/// and are refreshed on document load and when the underlying properties change.
/// Together they are accessed ~17 times across 4 files (formatting, viewport_render,
/// queries, and the engine itself).
use std::collections::HashMap;

use compute_formats::CultureInfo;

pub(crate) struct EngineSettings {
    /// Cached locale derived from the workbook culture setting.
    pub(super) locale: CultureInfo,

    /// Theme colour palette loaded from workbook properties.
    pub(super) theme_palette: HashMap<String, String>,
}
