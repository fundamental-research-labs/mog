//! Date/Time functions: DATE, YEAR, MONTH, DAY, HOUR, MINUTE,
//! SECOND, DATEVALUE, EDATE, EOMONTH, WEEKDAY, DATEDIF, DAYS, NETWORKDAYS,
//! EPOCHTODATE, and related Excel-compatible date/time functions.
//!
//! Excel serial date numbers: days since 1899-12-30 (not 1900-01-01).
//! This is because of the Lotus 1-2-3 leap year bug: Excel incorrectly
//! treats 1900 as a leap year. Day 1 = 1900-01-01, Day 60 = 1900-02-29 (fake),
//! Day 61 = 1900-03-01.
//!
//! Time is represented as the fractional part of a serial number:
//! 0.0 = midnight, 0.5 = noon, 0.75 = 6:00 PM.

mod arithmetic;
mod array_lift;
mod calendar;
mod construction;
mod extraction;
mod parsing;
mod time;
mod week;
mod workdays;
mod yearfrac;

#[cfg(test)]
mod test_helpers;

use crate::FunctionRegistry;

pub fn register(registry: &mut FunctionRegistry) {
    construction::register(registry);
    extraction::register(registry);
    parsing::register_datevalue(registry);
    arithmetic::register_edate_eomonth(registry);
    week::register_weekday(registry);
    arithmetic::register_datedif_days(registry);
    workdays::register_networkdays(registry);
    arithmetic::register_days360(registry);
    week::register_isoweeknum(registry);
    workdays::register_networkdays_intl(registry);
    time::register(registry);
    parsing::register_timevalue(registry);
    week::register_weeknum(registry);
    workdays::register_workday(registry);
    workdays::register_workday_intl(registry);
    yearfrac::register(registry);
}

#[cfg(test)]
mod source_shape_tests {
    use std::fs;
    use std::path::Path;

    fn implementation_line_count(path: &Path) -> usize {
        let source = fs::read_to_string(path)
            .unwrap_or_else(|err| panic!("failed to read {}: {err}", path.display()))
            .split("\n#[cfg(test)]")
            .next()
            .unwrap_or_default()
            .to_string();

        source
            .lines()
            .filter(|line| {
                let trimmed = line.trim();
                !trimmed.is_empty() && !trimmed.starts_with("//") && !trimmed.starts_with("#!")
            })
            .count()
    }

    #[test]
    fn datetime_modules_stay_focused() {
        let datetime_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/datetime");
        let root = datetime_dir.join("mod.rs");
        assert!(
            implementation_line_count(&root) < 160,
            "datetime/mod.rs should stay a small registration root"
        );

        for entry in fs::read_dir(&datetime_dir).expect("datetime module directory exists") {
            let path = entry.expect("datetime module entry").path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("rs")
                || path.file_name().and_then(|name| name.to_str()) == Some("mod.rs")
            {
                continue;
            }

            let lines = implementation_line_count(&path);
            assert!(
                lines <= 700,
                "{} has {lines} implementation lines; split the ownership before it grows further",
                path.display()
            );
        }
    }
}
