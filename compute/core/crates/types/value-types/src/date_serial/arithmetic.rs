use super::calendar::{days_in_month, is_leap_year, serial_to_ymd, ymd_to_serial};

/// Add months to a serial date.
///
/// The day is clamped to the last day of the target month (e.g. Jan 31 + 1 month = Feb 28/29).
#[must_use]
pub fn add_months_to_serial(serial: f64, months: i32) -> f64 {
    let (y, m, d) = serial_to_ymd(serial);
    let mut new_month = m + months;
    let mut new_year = y;

    if !(1..=12).contains(&new_month) {
        new_year += (new_month - 1).div_euclid(12);
        new_month = (new_month - 1).rem_euclid(12) + 1;
    }

    let max_day = days_in_month(new_year, new_month).unwrap_or(31);
    let new_day = d.min(max_day);
    ymd_to_serial(new_year, new_month, new_day)
}

/// Actual days between two serial dates.
#[must_use]
pub fn actual_days_between(start: f64, end: f64) -> f64 {
    end.floor() - start.floor()
}

/// 30/360 days between two serial dates.
///
/// Method 0 is US (NASD), and method 4 is European. Unknown methods use US
/// behavior.
#[must_use]
pub fn days360_between(start_serial: f64, end_serial: f64, method: i32) -> f64 {
    let (sy, sm, mut sd) = serial_to_ymd(start_serial);
    let (ey, em, mut ed) = serial_to_ymd(end_serial);

    if method == 4 {
        if sd == 31 {
            sd = 30;
        }
        if ed == 31 {
            ed = 30;
        }
    } else {
        let start_is_last_feb = sm == 2 && sd == days_in_month(sy, 2).unwrap_or(28);
        let end_is_last_feb = em == 2 && ed == days_in_month(ey, 2).unwrap_or(28);
        if start_is_last_feb {
            sd = 30;
        }
        if end_is_last_feb && start_is_last_feb {
            ed = 30;
        }
        if sd == 31 {
            sd = 30;
        }
        if ed == 31 && sd >= 30 {
            ed = 30;
        }
    }

    f64::from((ey - sy) * 360 + (em - sm) * 30 + (ed - sd))
}

/// Year fraction between two dates given basis.
///
/// Basis values: 0 = US 30/360, 1 = Actual/actual, 2 = Actual/360,
/// 3 = Actual/365, 4 = European 30/360. Unknown bases use US 30/360.
#[must_use]
#[allow(clippy::match_same_arms)]
pub fn year_frac(start: f64, end: f64, basis: i32) -> f64 {
    let (days, year_days) = match basis {
        0 => (days360_between(start, end, 0), 360.0),
        1 => {
            let d = actual_days_between(start, end);
            let (sy, _, _) = serial_to_ymd(start);
            let (ey, _, _) = serial_to_ymd(end);
            let avg_year_days = if sy == ey {
                if is_leap_year(sy) { 366.0 } else { 365.0 }
            } else {
                let num_years = ey - sy;
                let total_days: f64 = (sy..ey)
                    .map(|y| if is_leap_year(y) { 366.0 } else { 365.0 })
                    .sum();
                total_days / f64::from(num_years)
            };
            (d, avg_year_days)
        }
        2 => (actual_days_between(start, end), 360.0),
        3 => (actual_days_between(start, end), 365.0),
        4 => (days360_between(start, end, 4), 360.0),
        _ => (days360_between(start, end, 0), 360.0),
    };
    if year_days == 0.0 {
        0.0
    } else {
        days / year_days
    }
}

/// Days in year by basis.
///
/// Basis values: 0/2/4 = 360, 3 = 365, 1 = actual (365 or 366).
#[must_use]
#[allow(clippy::match_same_arms)]
pub fn days_in_year_by_basis(year: i32, basis: i32) -> f64 {
    match basis {
        0 | 2 | 4 => 360.0,
        3 => 365.0,
        1 => {
            if is_leap_year(year) {
                366.0
            } else {
                365.0
            }
        }
        _ => 360.0,
    }
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;

    #[test]
    fn add_months_basic() {
        let jan15 = ymd_to_serial(2024, 1, 15);
        let feb15 = ymd_to_serial(2024, 2, 15);
        assert_eq!(add_months_to_serial(jan15, 1), feb15);
    }

    #[test]
    fn add_months_clamp_day() {
        let jan31 = ymd_to_serial(2024, 1, 31);
        let feb29 = ymd_to_serial(2024, 2, 29);
        assert_eq!(add_months_to_serial(jan31, 1), feb29);

        let jan31_23 = ymd_to_serial(2023, 1, 31);
        let feb28_23 = ymd_to_serial(2023, 2, 28);
        assert_eq!(add_months_to_serial(jan31_23, 1), feb28_23);
    }

    #[test]
    fn add_months_negative() {
        let mar15 = ymd_to_serial(2024, 3, 15);
        let jan15 = ymd_to_serial(2024, 1, 15);
        assert_eq!(add_months_to_serial(mar15, -2), jan15);
    }

    #[test]
    fn add_months_cross_year() {
        let nov15 = ymd_to_serial(2023, 11, 15);
        let feb15 = ymd_to_serial(2024, 2, 15);
        assert_eq!(add_months_to_serial(nov15, 3), feb15);
    }

    #[test]
    fn add_months_negative_cross_year() {
        let jan31 = ymd_to_serial(2024, 1, 31);
        let dec31 = ymd_to_serial(2023, 12, 31);
        assert_eq!(add_months_to_serial(jan31, -1), dec31);
    }

    #[test]
    fn actual_days_between_basic() {
        let jan_first = ymd_to_serial(2024, 1, 1);
        let jan_last = ymd_to_serial(2024, 1, 31);
        assert_eq!(actual_days_between(jan_first, jan_last), 30.0);
    }

    #[test]
    fn actual_days_between_same_date() {
        let d = ymd_to_serial(2024, 6, 15);
        assert_eq!(actual_days_between(d, d), 0.0);
    }

    #[test]
    fn actual_days_between_floors_fractional_serials() {
        let start = ymd_to_serial(2024, 1, 1) + 0.75;
        let end = ymd_to_serial(2024, 1, 2) + 0.25;
        assert_eq!(actual_days_between(start, end), 1.0);
    }

    #[test]
    fn days360_us_basic() {
        let jan1 = ymd_to_serial(2024, 1, 1);
        let jul1 = ymd_to_serial(2024, 7, 1);
        assert_eq!(days360_between(jan1, jul1, 0), 180.0);
    }

    #[test]
    fn days360_us_unknown_method_defaults_to_us() {
        let jan1 = ymd_to_serial(2024, 1, 1);
        let jul1 = ymd_to_serial(2024, 7, 1);
        assert_eq!(days360_between(jan1, jul1, 99), 180.0);
    }

    #[test]
    fn days360_us_february_last_day_edges() {
        let feb29 = ymd_to_serial(2024, 2, 29);
        let mar31 = ymd_to_serial(2024, 3, 31);
        assert_eq!(days360_between(feb29, mar31, 0), 30.0);

        let feb28 = ymd_to_serial(2023, 2, 28);
        let mar31_23 = ymd_to_serial(2023, 3, 31);
        assert_eq!(days360_between(feb28, mar31_23, 0), 30.0);
    }

    #[test]
    fn days360_european_31st() {
        let jan31 = ymd_to_serial(2024, 1, 31);
        let mar31 = ymd_to_serial(2024, 3, 31);
        assert_eq!(days360_between(jan31, mar31, 4), 60.0);
    }

    #[test]
    fn year_frac_basis0() {
        let jan1 = ymd_to_serial(2024, 1, 1);
        let jul1 = ymd_to_serial(2024, 7, 1);
        assert!((year_frac(jan1, jul1, 0) - 0.5).abs() < 1e-10);
    }

    #[test]
    fn year_frac_basis2() {
        let jan1 = ymd_to_serial(2024, 1, 1);
        let feb1 = ymd_to_serial(2024, 2, 1);
        assert!((year_frac(jan1, feb1, 2) - 31.0 / 360.0).abs() < 1e-10);
    }

    #[test]
    fn year_frac_basis3() {
        let jan1 = ymd_to_serial(2024, 1, 1);
        let feb1 = ymd_to_serial(2024, 2, 1);
        assert!((year_frac(jan1, feb1, 3) - 31.0 / 365.0).abs() < 1e-10);
    }

    #[test]
    fn year_frac_basis4() {
        let jan31 = ymd_to_serial(2024, 1, 31);
        let mar31 = ymd_to_serial(2024, 3, 31);
        assert!((year_frac(jan31, mar31, 4) - 60.0 / 360.0).abs() < 1e-10);
    }

    #[test]
    fn year_frac_unknown_basis_defaults_to_us() {
        let jan1 = ymd_to_serial(2024, 1, 1);
        let jul1 = ymd_to_serial(2024, 7, 1);
        assert_eq!(year_frac(jan1, jul1, 99), year_frac(jan1, jul1, 0));
    }

    #[test]
    fn days_in_year_by_basis_all() {
        assert_eq!(days_in_year_by_basis(2024, 0), 360.0);
        assert_eq!(days_in_year_by_basis(2024, 1), 366.0);
        assert_eq!(days_in_year_by_basis(2023, 1), 365.0);
        assert_eq!(days_in_year_by_basis(2024, 2), 360.0);
        assert_eq!(days_in_year_by_basis(2024, 3), 365.0);
        assert_eq!(days_in_year_by_basis(2024, 4), 360.0);
        assert_eq!(days_in_year_by_basis(2024, 99), 360.0);
    }

    #[test]
    fn year_frac_basis1_same_year_leap() {
        let jan1 = ymd_to_serial(2024, 1, 1);
        let jul1 = ymd_to_serial(2024, 7, 1);
        let frac = year_frac(jan1, jul1, 1);
        assert!(
            (frac - 182.0 / 366.0).abs() < 1e-10,
            "same-year leap: expected {}, got {frac}",
            182.0 / 366.0
        );
    }

    #[test]
    fn year_frac_basis1_multi_year_exact() {
        let start = ymd_to_serial(2023, 1, 1);
        let end = ymd_to_serial(2025, 1, 1);
        let frac = year_frac(start, end, 1);
        assert!(
            (frac - 2.0).abs() < 1e-10,
            "multi-year exact: expected 2.0, got {frac}"
        );
    }

    #[test]
    fn year_frac_basis1_cross_leap_year() {
        let start = ymd_to_serial(2023, 7, 1);
        let end = ymd_to_serial(2025, 7, 1);
        let frac = year_frac(start, end, 1);
        assert!(
            (frac - 2.0).abs() < 1e-10,
            "cross-leap: expected 2.0, got {frac}"
        );
    }

    #[test]
    fn year_frac_basis1_single_year_non_leap() {
        let start = ymd_to_serial(2023, 1, 1);
        let end = ymd_to_serial(2023, 4, 1);
        let frac = year_frac(start, end, 1);
        assert!(
            (frac - 90.0 / 365.0).abs() < 1e-10,
            "same-year non-leap: expected {}, got {frac}",
            90.0 / 365.0
        );
    }
}
