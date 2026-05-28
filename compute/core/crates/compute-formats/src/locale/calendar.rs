use super::types::CultureInfo;

/// Return the full month name for `month_index` (0 = January, 11 = December).
///
/// Indices outside 0..12 wrap via modulo.
pub fn get_month_name(ci: &CultureInfo, month_index: usize) -> &str {
    &ci.month_names[month_index % 12]
}

/// Return the abbreviated month name for `month_index` (0 = January, 11 = December).
pub fn get_abbreviated_month_name(ci: &CultureInfo, month_index: usize) -> &str {
    &ci.abbreviated_month_names[month_index % 12]
}

/// Return the first letter of the full month name for `month_index`.
///
/// This is used by certain Excel format codes (e.g. `mmmmm`).
pub fn get_month_first_letter(ci: &CultureInfo, month_index: usize) -> &str {
    let name = get_month_name(ci, month_index);
    let first_char_len = name.chars().next().map_or(0, char::len_utf8);
    &name[..first_char_len]
}

/// Return the full day name for `day_of_week` (0 = Sunday, 6 = Saturday).
pub fn get_day_name(ci: &CultureInfo, day_of_week: usize) -> &str {
    &ci.day_names[day_of_week % 7]
}

/// Return the abbreviated day name for `day_of_week` (0 = Sunday, 6 = Saturday).
pub fn get_abbreviated_day_name(ci: &CultureInfo, day_of_week: usize) -> &str {
    &ci.abbreviated_day_names[day_of_week % 7]
}

/// Return the AM or PM designator based on the hour (0-23).
pub fn get_am_pm_designator(ci: &CultureInfo, hours: u32) -> &str {
    if hours < 12 {
        &ci.am_designator
    } else {
        &ci.pm_designator
    }
}
