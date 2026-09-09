//! Calendar rules must interpret workbook serials at the production CF boundary.
use super::*;
use crate::cf::types::{CellValueComparison, CellValueSingleOp, CellValueThreshold, DatePeriod};
use crate::eval::clock::RecalcClock;
use chrono::NaiveDate;
use value_types::date_serial::date_to_serial;

fn calendar_rule(period: DatePeriod) -> CFRule {
    CFRule {
        priority: 1,
        stop_if_true: false,
        ranges: vec![default_range()],
        style: Some(test_style()),
        kind: CFRuleKind::TimePeriod { period },
    }
}

fn date_core(date1904: bool, serials: &[f64; 5]) -> (ComputeCore, CellMirror) {
    let mut snapshot = make_cf_snapshot();
    for (cell, serial) in snapshot.sheets[0].cells.iter_mut().zip(serials) {
        cell.value = CellValue::number(*serial);
    }
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();
    mirror.date1904 = date1904;
    (core, mirror)
}

fn matched_rows(core: &ComputeCore, mirror: &CellMirror, rule: CFRule, now: NaiveDate) -> Vec<u32> {
    let clock = RecalcClock::for_recalc(Some(date_to_serial(&now) + 0.75));
    let mut rows: Vec<_> = core
        .eval_cf_with_clock(mirror, &sheet_id(), &[rule], clock)
        .into_iter()
        .map(|result| result.row)
        .collect();
    rows.sort_unstable();
    rows
}

#[test]
fn cf_calendar_today_month_year_use_workbook_date_system() {
    let now = NaiveDate::from_ymd_opt(2026, 1, 15).unwrap();
    let dates = [
        (2026, 1, 15),
        (2026, 1, 1),
        (2026, 6, 10),
        (2025, 12, 31),
        (2027, 1, 1),
    ];
    for date1904 in [false, true] {
        let serials = dates.map(|(y, m, d)| {
            date_to_serial(&NaiveDate::from_ymd_opt(y, m, d).unwrap())
                - if date1904 { 1462.0 } else { 0.0 }
                + 0.5
        });
        let (core, mirror) = date_core(date1904, &serials);
        for (period, expected) in [
            (DatePeriod::Today, vec![0]),
            (DatePeriod::ThisMonth, vec![0, 1]),
            (DatePeriod::ThisYear, vec![0, 1, 2]),
            (DatePeriod::LastMonth, vec![3]),
            (DatePeriod::NextYear, vec![4]),
        ] {
            assert_eq!(
                matched_rows(&core, &mirror, calendar_rule(period), now),
                expected,
                "date1904={date1904}, period={period:?}"
            );
        }
    }
}

#[test]
fn cf_calendar_serial_zero_is_1904_epoch_and_numeric_comparisons_stay_raw() {
    let epoch1904 = NaiveDate::from_ymd_opt(1904, 1, 1).unwrap();
    for date1904 in [false, true] {
        let (core, mirror) = date_core(date1904, &[0.0, 0.5, -1.0, 1.0, 1462.0]);
        assert_eq!(
            matched_rows(&core, &mirror, calendar_rule(DatePeriod::Today), epoch1904),
            if date1904 { vec![0, 1] } else { vec![4] },
        );
        // The 1900 compatibility entrypoint excludes serial zero, even when
        // the reference date is the calendar epoch used by date conversion.
        if !date1904 {
            assert!(
                matched_rows(
                    &core,
                    &mirror,
                    calendar_rule(DatePeriod::Today),
                    NaiveDate::from_ymd_opt(1899, 12, 31).unwrap()
                )
                .is_empty()
            );
        }
        for (threshold, expected) in [(0.0, vec![0]), (1462.0, vec![4])] {
            let mut rule = calendar_rule(DatePeriod::Today);
            rule.kind = CFRuleKind::CellValue {
                comparison: CellValueComparison::Single {
                    operator: CellValueSingleOp::Equal,
                    threshold: CellValueThreshold {
                        text: threshold.to_string(),
                        number: Some(threshold),
                    },
                },
            };
            assert_eq!(matched_rows(&core, &mirror, rule, epoch1904), expected);
        }
    }
}
