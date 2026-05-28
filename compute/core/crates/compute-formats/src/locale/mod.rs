//! Culture information for number, date, and currency formatting.
//!
//! Provides culture-aware formatting options: decimal/thousands separators,
//! currency symbols, date patterns, and localized month/day names.

mod arrays;
mod calendar;
mod data;
mod registry;
mod types;

#[cfg(test)]
mod tests;

pub use calendar::{
    get_abbreviated_day_name, get_abbreviated_month_name, get_am_pm_designator, get_day_name,
    get_month_first_letter, get_month_name,
};
pub use registry::{get_all_cultures, get_culture};
pub use types::{CultureInfo, DateOrder};
