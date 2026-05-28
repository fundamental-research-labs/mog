use chrono::Datelike;

use crate::storage::engine::settings::EngineSettings;

pub(in crate::storage::engine::viewport) fn parse_date_input(
    settings: &EngineSettings,
    text: &str,
) -> Option<compute_formats::ParsedDateInput> {
    let default_year = crate::eval::clock::current_calendar_date().year();
    compute_formats::parse_date_input_with_default_year(text, &settings.locale, default_year)
}

/// Format a batch of cell values using format codes and the workbook's locale.
pub(in crate::storage::engine::viewport) fn format_values(
    settings: &EngineSettings,
    entries: Vec<compute_formats::FormatEntry>,
) -> Vec<String> {
    compute_formats::format_values_batch(&entries, &settings.locale)
}
