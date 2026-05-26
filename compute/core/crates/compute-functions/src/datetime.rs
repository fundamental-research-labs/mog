//! Date/Time functions: DATE, YEAR, MONTH, DAY, HOUR, MINUTE,
//! SECOND, DATEVALUE, EDATE, EOMONTH, WEEKDAY, DATEDIF, DAYS, NETWORKDAYS,
//! EPOCHTODATE.
//!
//! Excel serial date numbers: days since 1899-12-30 (not 1900-01-01).
//! This is because of the Lotus 1-2-3 leap year bug: Excel incorrectly
//! treats 1900 as a leap year. Day 1 = 1900-01-01, Day 60 = 1900-02-29 (fake),
//! Day 61 = 1900-03-01.
//!
//! Time is represented as the fractional part of a serial number:
//! 0.0 = midnight, 0.5 = noon, 0.75 = 6:00 PM.

use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, Timelike};

use value_types::{CellError, CellValue};

use crate::helpers::coercion::{check_error, flatten_values};
use crate::helpers::date_serial::{date_to_serial, serial_to_date};
use crate::{FunctionRegistry, PureFunction};

#[allow(dead_code)]
fn serial_to_datetime(serial: f64) -> Option<NaiveDateTime> {
    let date = serial_to_date(serial)?;
    let frac = serial - serial.floor();
    let total_seconds = (frac * 86400.0).round() as u32;
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;
    date.and_hms_opt(hours, minutes, seconds)
}

/// Compute Excel-compatible day-of-week directly from serial number.
/// Returns 0=Sunday, 1=Monday, ..., 6=Saturday.
///
/// This avoids going through NaiveDate and chrono's weekday(), which gives the
/// REAL calendar day. Excel's calendar has a fake Feb 29, 1900 (serial 60) due
/// to the Lotus 1-2-3 bug, so for serials 1-59 the real weekday is off by one.
/// Computing (serial - 1) % 7 directly gives Excel's expected weekday for ALL
/// serial numbers because Excel's epoch (serial 1) is defined as Sunday.
fn excel_dow_from_serial(serial: f64) -> Option<u32> {
    let days = serial.floor() as i64;
    if days < 1 {
        return None;
    }
    // Excel weekday: serial 1 = Sunday, serial 2 = Monday, etc.
    // (days - 1) % 7 gives 0=Sun, 1=Mon, ..., 6=Sat
    Some(((days - 1).rem_euclid(7)) as u32)
}

/// Check if an Excel serial number falls on a weekend day.
/// Uses Excel's serial-based DOW calculation for consistency with Excel's
/// Lotus 1-2-3 bug calendar.
/// Returns true if the serial falls on Saturday or Sunday.
fn is_excel_weekend(serial: f64) -> bool {
    match excel_dow_from_serial(serial) {
        Some(dow) => dow == 0 || dow == 6, // 0=Sunday, 6=Saturday
        None => false,
    }
}

/// Check if an Excel serial number falls on a weekend day according to a mask.
/// Uses Excel's serial-based DOW calculation for consistency.
/// The mask is [Mon, Tue, Wed, Thu, Fri, Sat, Sun] where true = weekend.
fn is_excel_weekend_mask(serial: f64, weekend_mask: &[bool; 7]) -> bool {
    match excel_dow_from_serial(serial) {
        Some(dow) => {
            // dow: 0=Sun, 1=Mon, ..., 6=Sat
            // mask: 0=Mon, 1=Tue, ..., 5=Sat, 6=Sun
            let mask_idx = if dow == 0 { 6 } else { (dow - 1) as usize };
            weekend_mask[mask_idx]
        }
        None => false,
    }
}

// ---------------------------------------------------------------------------
// Array broadcasting helpers (for SUMPRODUCT compatibility)
// ---------------------------------------------------------------------------

/// Extract (rows, cols) dimensions from a CellValue::Array.
fn array_dims(val: &CellValue) -> Option<(usize, usize)> {
    match val {
        CellValue::Array(arr) => Some((arr.rows(), arr.cols())),
        _ => None,
    }
}

/// Index into a CellValue: if it's an array, return the element at (row, col);
/// if it's a scalar, return a clone (broadcast). Out-of-bounds returns #N/A.
fn array_get(val: &CellValue, row: usize, col: usize) -> CellValue {
    match val {
        CellValue::Array(arr) => arr
            .get(row, col)
            .cloned()
            .unwrap_or(CellValue::Error(CellError::Na, None)),
        other => other.clone(),
    }
}

/// Check if any value in the slice is a CellValue::Array.
fn has_any_array(args: &[CellValue]) -> bool {
    args.iter().any(|a| matches!(a, CellValue::Array(_)))
}

/// Compute the broadcast dimensions (max rows, max cols) across all array args.
fn broadcast_dims(args: &[CellValue]) -> (usize, usize) {
    args.iter()
        .filter_map(array_dims)
        .fold((1, 1), |(r, c), (ar, ac)| (r.max(ar), c.max(ac)))
}

// ---------------------------------------------------------------------------
// Date construction / extraction
// ---------------------------------------------------------------------------

pub struct FnDate;

/// Scalar DATE logic: takes three scalar CellValues (year, month, day) and returns the result.
fn date_scalar(args: &[CellValue]) -> CellValue {
    if let Some(e) = check_error(&args[0]) {
        return e;
    }
    if let Some(e) = check_error(&args[1]) {
        return e;
    }
    if let Some(e) = check_error(&args[2]) {
        return e;
    }
    let year = match args[0].coerce_to_number() {
        Ok(n) => {
            let y = n as i32;
            // Excel DATE function: year 0-1899 => year + 1900, 1900+ => literal.
            if (0..1900).contains(&y) { y + 1900 } else { y }
        }
        Err(e) => return CellValue::Error(e, None),
    };
    let month = match args[1].coerce_to_number() {
        Ok(n) => n as i32,
        Err(e) => return CellValue::Error(e, None),
    };
    let day = match args[2].coerce_to_number() {
        Ok(n) => n as i32,
        Err(e) => return CellValue::Error(e, None),
    };

    // Handle out-of-range months and days
    let adjusted_year = year + (month - 1).div_euclid(12);
    let adjusted_month = ((month - 1).rem_euclid(12) + 1) as u32;

    match NaiveDate::from_ymd_opt(adjusted_year, adjusted_month, 1) {
        Some(base) => {
            let final_date = base + Duration::days((day - 1) as i64);
            let serial = date_to_serial(&final_date);

            // Handle the Lotus 1-2-3 leap year bug
            let mar1_1900 =
                NaiveDate::from_ymd_opt(1900, 3, 1).expect("1900-03-01 is always valid");
            if base < mar1_1900 && final_date >= mar1_1900 {
                CellValue::number(serial - 1.0)
            } else {
                CellValue::number(serial)
            }
        }
        None => CellValue::error_with_message(
            CellError::Num,
            "DATE: resulting date is out of range".to_string(),
        ),
    }
}

impl PureFunction for FnDate {
    fn name(&self) -> &'static str {
        "DATE"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // Array broadcasting for SUMPRODUCT compatibility
        if has_any_array(args) {
            let (max_rows, max_cols) = broadcast_dims(args);
            let mut result = Vec::with_capacity(max_rows);
            for row in 0..max_rows {
                let mut row_vals = Vec::with_capacity(max_cols);
                for col in 0..max_cols {
                    let scalar_args: Vec<CellValue> =
                        args.iter().map(|a| array_get(a, row, col)).collect();
                    row_vals.push(date_scalar(&scalar_args));
                }
                result.push(row_vals);
            }
            return CellValue::from_rows(result);
        }
        date_scalar(args)
    }
}

pub struct FnEpochToDate;
impl PureFunction for FnEpochToDate {
    fn name(&self) -> &'static str {
        "EPOCHTODATE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let timestamp = match args[0].coerce_to_number() {
            Ok(n) if n.is_finite() => n,
            Ok(_) => return CellValue::Error(CellError::Value, None),
            Err(e) => return CellValue::Error(e, None),
        };
        if timestamp < 0.0 {
            return CellValue::Error(CellError::Num, None);
        }

        let unit = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(n) if n.is_finite() => n.trunc() as i32,
                Ok(_) => return CellValue::Error(CellError::Value, None),
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };

        let millis = match unit {
            1 => timestamp * 1000.0,
            2 => timestamp.trunc(),
            3 => (timestamp / 1000.0).trunc(),
            _ => return CellValue::Error(CellError::Num, None),
        };
        if !millis.is_finite() {
            return CellValue::Error(CellError::Num, None);
        }

        let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).expect("1970-01-01 is valid");
        let serial = millis / 86_400_000.0 + date_to_serial(&epoch);
        if serial.is_finite() {
            CellValue::number(serial)
        } else {
            CellValue::Error(CellError::Num, None)
        }
    }
}

pub struct FnYear;
impl PureFunction for FnYear {
    fn name(&self) -> &'static str {
        "YEAR"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                if n < 0.0 {
                    CellValue::error_with_message(
                        CellError::Num,
                        format!("YEAR: serial number must be non-negative, got {n}"),
                    )
                } else {
                    let (y, _, _) = crate::helpers::date_serial::serial_to_ymd(n);
                    CellValue::number(y as f64)
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub struct FnMonth;
impl PureFunction for FnMonth {
    fn name(&self) -> &'static str {
        "MONTH"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                if n < 0.0 {
                    CellValue::error_with_message(
                        CellError::Num,
                        format!("MONTH: serial number must be non-negative, got {n}"),
                    )
                } else {
                    let (_, m, _) = crate::helpers::date_serial::serial_to_ymd(n);
                    CellValue::number(m as f64)
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub struct FnDay;
impl PureFunction for FnDay {
    fn name(&self) -> &'static str {
        "DAY"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                if n < 0.0 {
                    CellValue::error_with_message(
                        CellError::Num,
                        format!("DAY: serial number must be non-negative, got {n}"),
                    )
                } else {
                    let (_, _, d) = crate::helpers::date_serial::serial_to_ymd(n);
                    CellValue::number(d as f64)
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub struct FnHour;
impl PureFunction for FnHour {
    fn name(&self) -> &'static str {
        "HOUR"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                let frac = n - n.floor();
                let total_seconds = (frac * 86400.0).round() as u32;
                let hours = total_seconds / 3600;
                CellValue::number(hours as f64)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub struct FnMinute;
impl PureFunction for FnMinute {
    fn name(&self) -> &'static str {
        "MINUTE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                let frac = n - n.floor();
                let total_seconds = (frac * 86400.0).round() as u32;
                let minutes = (total_seconds % 3600) / 60;
                CellValue::number(minutes as f64)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub struct FnSecond;
impl PureFunction for FnSecond {
    fn name(&self) -> &'static str {
        "SECOND"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                let frac = n - n.floor();
                let total_seconds = (frac * 86400.0).round() as u32;
                let seconds = total_seconds % 60;
                CellValue::number(seconds as f64)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub struct FnDatevalue;
impl PureFunction for FnDatevalue {
    fn name(&self) -> &'static str {
        "DATEVALUE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let text = match args[0].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        let trimmed = text.trim();
        // Try date-only first, then datetime (discarding time portion like Excel).
        match value_types::date_serial::try_parse_date(trimmed)
            .or_else(|_| value_types::date_serial::try_parse_datetime(trimmed).map(|s| s.floor()))
        {
            Ok(serial) => CellValue::number(serial),
            Err(_) => CellValue::error_with_message(
                CellError::Value,
                format!("DATEVALUE: could not parse '{trimmed}' as a date"),
            ),
        }
    }
}

// ---------------------------------------------------------------------------
// Date arithmetic
// ---------------------------------------------------------------------------

pub struct FnEdate;

/// Scalar EDATE logic: takes two scalar CellValues (start_date, months).
fn edate_scalar(args: &[CellValue]) -> CellValue {
    if let Some(e) = check_error(&args[0]) {
        return e;
    }
    if let Some(e) = check_error(&args[1]) {
        return e;
    }
    let serial = match args[0].coerce_to_number() {
        Ok(n) => n,
        Err(e) => return CellValue::Error(e, None),
    };
    let months = match args[1].coerce_to_number() {
        Ok(n) => n as i32,
        Err(e) => return CellValue::Error(e, None),
    };
    match serial_to_date(serial) {
        Some(d) => match add_months(d, months) {
            Some(new_date) => {
                let serial = date_to_serial(&new_date);
                if serial < 1.0 {
                    CellValue::error_with_message(
                        CellError::Num,
                        "EDATE: resulting date is before the epoch".to_string(),
                    )
                } else {
                    CellValue::number(serial)
                }
            }
            None => CellValue::error_with_message(
                CellError::Num,
                format!("EDATE: could not compute date after adding {months} months"),
            ),
        },
        None => CellValue::error_with_message(
            CellError::Num,
            format!("EDATE: invalid start date serial number {serial}"),
        ),
    }
}

impl PureFunction for FnEdate {
    fn name(&self) -> &'static str {
        "EDATE"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // Array broadcasting for SUMPRODUCT compatibility
        if has_any_array(args) {
            let (max_rows, max_cols) = broadcast_dims(args);
            let mut result = Vec::with_capacity(max_rows);
            for row in 0..max_rows {
                let mut row_vals = Vec::with_capacity(max_cols);
                for col in 0..max_cols {
                    let scalar_args: Vec<CellValue> =
                        args.iter().map(|a| array_get(a, row, col)).collect();
                    row_vals.push(edate_scalar(&scalar_args));
                }
                result.push(row_vals);
            }
            return CellValue::from_rows(result);
        }
        edate_scalar(args)
    }
}

pub struct FnEomonth;

/// Scalar EOMONTH logic: takes two scalar CellValues (start_date, months).
fn eomonth_scalar(args: &[CellValue]) -> CellValue {
    if let Some(e) = check_error(&args[0]) {
        return e;
    }
    if let Some(e) = check_error(&args[1]) {
        return e;
    }
    let serial = match args[0].coerce_to_number() {
        Ok(n) => n,
        Err(e) => return CellValue::Error(e, None),
    };
    let months = match args[1].coerce_to_number() {
        Ok(n) => n as i32,
        Err(e) => return CellValue::Error(e, None),
    };
    match serial_to_date(serial) {
        Some(d) => {
            let target_year = d.year() + (d.month0() as i32 + months).div_euclid(12);
            let target_month = ((d.month0() as i32 + months).rem_euclid(12) + 1) as u32;
            let last_day = last_day_of_month(target_year, target_month);
            match NaiveDate::from_ymd_opt(target_year, target_month, last_day) {
                Some(end_date) => {
                    let serial = date_to_serial(&end_date);
                    if serial < 1.0 {
                        CellValue::error_with_message(
                            CellError::Num,
                            "EOMONTH: resulting date is before the epoch".to_string(),
                        )
                    } else {
                        CellValue::number(serial)
                    }
                }
                None => CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "EOMONTH: could not construct end-of-month date for {target_year}-{target_month}"
                    ),
                ),
            }
        }
        None => CellValue::error_with_message(
            CellError::Num,
            format!("EOMONTH: invalid start date serial number {serial}"),
        ),
    }
}

impl PureFunction for FnEomonth {
    fn name(&self) -> &'static str {
        "EOMONTH"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // Array broadcasting for SUMPRODUCT compatibility
        if has_any_array(args) {
            let (max_rows, max_cols) = broadcast_dims(args);
            let mut result = Vec::with_capacity(max_rows);
            for row in 0..max_rows {
                let mut row_vals = Vec::with_capacity(max_cols);
                for col in 0..max_cols {
                    let scalar_args: Vec<CellValue> =
                        args.iter().map(|a| array_get(a, row, col)).collect();
                    row_vals.push(eomonth_scalar(&scalar_args));
                }
                result.push(row_vals);
            }
            return CellValue::from_rows(result);
        }
        eomonth_scalar(args)
    }
}

pub struct FnWeekday;
impl PureFunction for FnWeekday {
    fn name(&self) -> &'static str {
        "WEEKDAY"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            1 => Some(CellValue::number(1.0)), // return_type defaults to 1 (Sunday=1)
            _ => None,
        }
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let serial = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let return_type = if args.len() > 1 {
            match args[1].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };
        // Compute day-of-week directly from serial number to match Excel's
        // Lotus 1-2-3 bug calendar. Using chrono weekday would give the wrong
        // result for serials 1-59 (before the fake Feb 29, 1900).
        match excel_dow_from_serial(serial) {
            Some(dow) => {
                let dow = dow as i32; // 0=Sun, 1=Mon, ..., 6=Sat
                let result = match return_type {
                    1 => dow + 1, // 1=Sun, 7=Sat (default)
                    2 => {
                        // 1=Mon, 7=Sun
                        if dow == 0 { 7 } else { dow }
                    }
                    3 => {
                        // 0=Mon, 6=Sun
                        if dow == 0 { 6 } else { dow - 1 }
                    }
                    // Return types 11-17: ((dow - offset + 7) % 7) + 1
                    // 11: Mon=1..Sun=7  (offset=1)
                    // 12: Tue=1..Mon=7  (offset=2)
                    // 13: Wed=1..Tue=7  (offset=3)
                    // 14: Thu=1..Wed=7  (offset=4)
                    // 15: Fri=1..Thu=7  (offset=5)
                    // 16: Sat=1..Fri=7  (offset=6)
                    // 17: Sun=1..Sat=7  (offset=0)
                    11 => ((dow - 1 + 7) % 7) + 1,
                    12 => ((dow - 2 + 7) % 7) + 1,
                    13 => ((dow - 3 + 7) % 7) + 1,
                    14 => ((dow - 4 + 7) % 7) + 1,
                    15 => ((dow - 5 + 7) % 7) + 1,
                    16 => ((dow - 6 + 7) % 7) + 1,
                    17 => (dow % 7) + 1,
                    _ => {
                        return CellValue::error_with_message(
                            CellError::Num,
                            format!("WEEKDAY: invalid return_type {return_type}"),
                        );
                    }
                };
                CellValue::number(result as f64)
            }
            None => CellValue::error_with_message(
                CellError::Num,
                "WEEKDAY: invalid serial number".to_string(),
            ),
        }
    }
}

pub struct FnDatedif;
impl PureFunction for FnDatedif {
    fn name(&self) -> &'static str {
        "DATEDIF"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        if let Some(e) = check_error(&args[2]) {
            return e;
        }
        let start_serial = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let end_serial = match args[1].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let unit = match args[2].coerce_to_string() {
            Ok(s) => s.to_uppercase(),
            Err(e) => return CellValue::Error(e, None),
        };
        if start_serial > end_serial {
            return CellValue::error_with_message(
                CellError::Num,
                "DATEDIF: start date must not be after end date".to_string(),
            );
        }
        let start = match serial_to_date(start_serial) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("DATEDIF: invalid start date serial number {start_serial}"),
                );
            }
        };
        let end = match serial_to_date(end_serial) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("DATEDIF: invalid end date serial number {end_serial}"),
                );
            }
        };
        let result = match unit.as_str() {
            "Y" => {
                // Complete years
                let mut years = end.year() - start.year();
                if (end.month(), end.day()) < (start.month(), start.day()) {
                    years -= 1;
                }
                years as f64
            }
            "M" => {
                // Complete months
                let mut months =
                    (end.year() - start.year()) * 12 + end.month() as i32 - start.month() as i32;
                if end.day() < start.day() {
                    months -= 1;
                }
                months as f64
            }
            "D" => {
                // Use serial difference directly to account for the Lotus 1-2-3
                // fake Feb 29, 1900 (serial 60) which NaiveDate can't represent.
                end_serial.floor() - start_serial.floor()
            }
            "MD" => {
                // Days ignoring months and years
                let mut days = end.day() as i32 - start.day() as i32;
                if days < 0 {
                    // Get days in previous month
                    let prev_month = if end.month() == 1 {
                        NaiveDate::from_ymd_opt(end.year() - 1, 12, 1)
                    } else {
                        NaiveDate::from_ymd_opt(end.year(), end.month() - 1, 1)
                    };
                    if let Some(pm) = prev_month {
                        let days_in_prev = last_day_of_month(pm.year(), pm.month());
                        days += days_in_prev as i32;
                    }
                }
                days as f64
            }
            "YM" => {
                // Months ignoring years
                let mut months = end.month() as i32 - start.month() as i32;
                if end.day() < start.day() {
                    months -= 1;
                }
                if months < 0 {
                    months += 12;
                }
                months as f64
            }
            "YD" => {
                // Days ignoring years
                let end_adjusted = NaiveDate::from_ymd_opt(start.year(), end.month(), end.day());
                let end_adjusted = match end_adjusted {
                    Some(ea) if ea >= start => Some(ea),
                    _ => NaiveDate::from_ymd_opt(start.year() + 1, end.month(), end.day()),
                };
                match end_adjusted {
                    Some(ea) => {
                        let mut days = (ea - start).num_days() as f64;
                        // Account for the Lotus 1-2-3 fake Feb 29, 1900 (serial 60).
                        // NaiveDate can't represent it, so if the adjusted range crosses
                        // where serial 60 would be (start <= 59 and end_adjusted >= Mar 1, 1900),
                        // we need to add 1 day.
                        let start_s = date_to_serial(&start);
                        let ea_s = date_to_serial(&ea);
                        if start_s <= 59.0 && ea_s >= 61.0 {
                            days += 1.0;
                        }
                        days
                    }
                    None => {
                        return CellValue::error_with_message(
                            CellError::Num,
                            "DATEDIF: could not compute YD difference".to_string(),
                        );
                    }
                }
            }
            _ => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("DATEDIF: invalid unit '{unit}', expected Y, M, D, MD, YM, or YD"),
                );
            }
        };
        CellValue::number(result)
    }
}

pub struct FnDays;
impl PureFunction for FnDays {
    fn name(&self) -> &'static str {
        "DAYS"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        let end_serial = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let start_serial = match args[1].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        // DAYS(end_date, start_date) = end - start
        CellValue::number(end_serial.floor() - start_serial.floor())
    }
}

pub struct FnNetworkdays;
impl PureFunction for FnNetworkdays {
    fn name(&self) -> &'static str {
        "NETWORKDAYS"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn is_scalar_arg(&self, index: usize) -> bool {
        index < 2
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        let start_serial = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let end_serial = match args[1].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };

        // Optional holidays array
        let holidays: Vec<f64> = if args.len() > 2 {
            let flat = flatten_values(&[args[2].clone()]);
            flat.iter()
                .filter_map(|v| v.coerce_to_number().ok())
                .map(|n| n.floor())
                .collect()
        } else {
            Vec::new()
        };

        // Validate that serial numbers are within a plausible range
        if start_serial.floor() < 1.0 || end_serial.floor() < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                "NETWORKDAYS: date serial numbers must be >= 1".to_string(),
            );
        }

        let (from_serial, to_serial, sign) = if start_serial.floor() <= end_serial.floor() {
            (start_serial.floor(), end_serial.floor(), 1i32)
        } else {
            (end_serial.floor(), start_serial.floor(), -1)
        };

        // Count workdays by iterating over serial numbers directly.
        // This correctly handles the Lotus 1-2-3 bug range (serials 1-60)
        // without losing a day due to NaiveDate's inability to represent
        // the fake Feb 29, 1900 (serial 60).
        let mut count = 0i32;
        let mut s = from_serial;
        while s <= to_serial {
            if !is_excel_weekend(s) && !holidays.iter().any(|&h| (h - s).abs() < 0.5) {
                count += 1;
            }
            s += 1.0;
        }

        CellValue::number((count * sign) as f64)
    }
}

// ---------------------------------------------------------------------------
// Additional date/time functions
// ---------------------------------------------------------------------------

pub struct FnDays360;
impl PureFunction for FnDays360 {
    fn name(&self) -> &'static str {
        "DAYS360"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        let start_serial = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let end_serial = match args[1].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let european = if args.len() > 2 {
            match args[2].coerce_to_bool() {
                Ok(b) => b,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            false // US method (default)
        };

        let start = match serial_to_date(start_serial) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("DAYS360: invalid start date serial number {start_serial}"),
                );
            }
        };
        let end = match serial_to_date(end_serial) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("DAYS360: invalid end date serial number {end_serial}"),
                );
            }
        };

        let mut sd = start.day() as i32;
        let sm = start.month() as i32;
        let sy = start.year();
        let mut ed = end.day() as i32;
        let em = end.month() as i32;
        let ey = end.year();

        if european {
            // European method: if day > 30, set to 30
            if sd == 31 {
                sd = 30;
            }
            if ed == 31 {
                ed = 30;
            }
        } else {
            // US (NASD) method -- four rules applied in order:
            // 1. If start date is last day of February, set sd=30
            // 2. If start date is last day of February AND end date is last day
            //    of February, set ed=30
            // 3. If sd == 31, set sd=30
            // 4. If ed == 31 and sd >= 30, set ed=30
            let start_is_last_feb = sm == 2 && sd == last_day_of_month(sy, sm as u32) as i32;
            let end_is_last_feb = em == 2 && ed == last_day_of_month(ey, em as u32) as i32;

            // Rule 1: start is last day of February
            if start_is_last_feb {
                sd = 30;
            }
            // Rule 2: both start and end are last day of February
            if start_is_last_feb && end_is_last_feb {
                ed = 30;
            }
            // Rule 3: If start day is 31, set to 30
            if sd == 31 {
                sd = 30;
            }
            // Rule 4: If end day is 31 and start day >= 30, set end to 30
            if ed == 31 && sd >= 30 {
                ed = 30;
            }
        }

        let days = (ey - sy) * 360 + (em - sm) * 30 + (ed - sd);
        CellValue::number(days as f64)
    }
}

pub struct FnIsoWeekNum;
impl PureFunction for FnIsoWeekNum {
    fn name(&self) -> &'static str {
        "ISOWEEKNUM"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let serial = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        // Use Excel serial-based ISO week calculation for Lotus bug consistency
        CellValue::number(excel_iso_week_from_serial(serial) as f64)
    }
}

pub struct FnNetworkdaysIntl;
impl PureFunction for FnNetworkdaysIntl {
    fn name(&self) -> &'static str {
        "NETWORKDAYS.INTL"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn is_scalar_arg(&self, index: usize) -> bool {
        index < 3
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        let start_serial = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let end_serial = match args[1].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };

        // Parse weekend parameter
        let weekend_mask = if args.len() > 2 {
            parse_weekend_param(&args[2])
        } else {
            Ok([false, false, false, false, false, true, true]) // Sat, Sun off
        };
        let weekend_mask = match weekend_mask {
            Ok(m) => m,
            Err(e) => return CellValue::Error(e, None),
        };

        // Optional holidays array
        let holidays: Vec<f64> = if args.len() > 3 {
            let flat = flatten_values(&[args[3].clone()]);
            flat.iter()
                .filter_map(|v| v.coerce_to_number().ok())
                .map(|n| n.floor())
                .collect()
        } else {
            Vec::new()
        };

        // Validate that serial numbers are within a plausible range
        if start_serial.floor() < 1.0 || end_serial.floor() < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                "NETWORKDAYS.INTL: date serial numbers must be >= 1".to_string(),
            );
        }

        let (from_serial, to_serial, sign) = if start_serial.floor() <= end_serial.floor() {
            (start_serial.floor(), end_serial.floor(), 1i32)
        } else {
            (end_serial.floor(), start_serial.floor(), -1)
        };

        // Count workdays by iterating over serial numbers directly.
        // This correctly handles the Lotus 1-2-3 bug range (serials 1-60).
        let mut count = 0i32;
        let mut s = from_serial;
        while s <= to_serial {
            if !is_excel_weekend_mask(s, &weekend_mask)
                && !holidays.iter().any(|&h| (h - s).abs() < 0.5)
            {
                count += 1;
            }
            s += 1.0;
        }

        CellValue::number((count * sign) as f64)
    }
}

pub struct FnTime;
impl PureFunction for FnTime {
    fn name(&self) -> &'static str {
        "TIME"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        if let Some(e) = check_error(&args[2]) {
            return e;
        }
        let hour = match args[0].coerce_to_number() {
            Ok(n) => n as i64,
            Err(e) => return CellValue::Error(e, None),
        };
        let minute = match args[1].coerce_to_number() {
            Ok(n) => n as i64,
            Err(e) => return CellValue::Error(e, None),
        };
        let second = match args[2].coerce_to_number() {
            Ok(n) => n as i64,
            Err(e) => return CellValue::Error(e, None),
        };

        let total_seconds = hour * 3600 + minute * 60 + second;
        if total_seconds < 0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("TIME: total seconds must be non-negative, got {total_seconds}"),
            );
        }
        // Wrap to 24-hour period
        let wrapped = total_seconds % 86400;
        let fraction = wrapped as f64 / 86400.0;
        CellValue::number(fraction)
    }
}

pub struct FnTimeValue;
impl PureFunction for FnTimeValue {
    fn name(&self) -> &'static str {
        "TIMEVALUE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let text = match args[0].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        // Try common time formats
        let formats = [
            "%H:%M:%S",
            "%H:%M",
            "%I:%M:%S %p",
            "%I:%M:%S %P",
            "%I:%M %p",
            "%I:%M %P",
        ];
        for fmt in &formats {
            if let Ok(t) = chrono::NaiveTime::parse_from_str(text.trim(), fmt) {
                let total_seconds =
                    t.hour() as f64 * 3600.0 + t.minute() as f64 * 60.0 + t.second() as f64;
                return CellValue::number(total_seconds / 86400.0);
            }
        }
        CellValue::error_with_message(
            CellError::Value,
            format!("TIMEVALUE: could not parse '{}' as a time", text.trim()),
        )
    }
}

pub struct FnWeekNum;
impl PureFunction for FnWeekNum {
    fn name(&self) -> &'static str {
        "WEEKNUM"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            1 => Some(CellValue::number(1.0)), // return_type defaults to 1 (Sunday start)
            _ => None,
        }
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let serial = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let return_type = if args.len() > 1 {
            match args[1].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };
        let date = match serial_to_date(serial) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("WEEKNUM: invalid date serial number {serial}"),
                );
            }
        };

        if return_type == 21 {
            // ISO week number - use Excel serial-based calculation for
            // Lotus 1-2-3 bug consistency
            return CellValue::number(excel_iso_week_from_serial(serial) as f64);
        }

        // Determine first day of week based on return_type
        // return_type 1 or 17: Sunday=0, 2 or 11: Monday=0, etc.
        let week_start_dow = match return_type {
            1 => 0u32, // Sunday
            2 => 1,    // Monday
            11 => 1,   // Monday
            12 => 2,   // Tuesday
            13 => 3,   // Wednesday
            14 => 4,   // Thursday
            15 => 5,   // Friday
            16 => 6,   // Saturday
            17 => 0,   // Sunday
            _ => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("WEEKNUM: invalid return_type {return_type}"),
                );
            }
        };

        // Compute Jan 1 day-of-week using serial number arithmetic to match
        // Excel's Lotus 1-2-3 bug calendar (avoids chrono weekday mismatch for 1900).
        let jan1 = match NaiveDate::from_ymd_opt(date.year(), 1, 1) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    "WEEKNUM: failed to construct Jan 1",
                );
            }
        };
        let jan1_serial = date_to_serial(&jan1);
        let jan1_dow = excel_dow_from_serial(jan1_serial).expect("valid serial from NaiveDate");

        // Days from Jan 1 to the date
        let day_of_year = (date - jan1).num_days();

        // Calculate week number
        // Shift by week_start_dow
        let adjusted_jan1 = (jan1_dow + 7 - week_start_dow) % 7;
        let week = (day_of_year as u32 + adjusted_jan1) / 7 + 1;

        CellValue::number(week as f64)
    }
}

pub struct FnWorkday;
impl PureFunction for FnWorkday {
    fn name(&self) -> &'static str {
        "WORKDAY"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn is_scalar_arg(&self, index: usize) -> bool {
        index < 2
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        let start_serial = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let days = match args[1].coerce_to_number() {
            Ok(n) => n as i32,
            Err(e) => return CellValue::Error(e, None),
        };

        let holidays: Vec<f64> = if args.len() > 2 {
            let flat = flatten_values(&[args[2].clone()]);
            flat.iter()
                .filter_map(|v| v.coerce_to_number().ok())
                .map(|n| n.floor())
                .collect()
        } else {
            Vec::new()
        };

        let start = match serial_to_date(start_serial) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("WORKDAY: invalid start date serial number {start_serial}"),
                );
            }
        };

        // Weekend mask: Sat and Sun are off (standard)
        let weekend_mask = [false, false, false, false, false, true, true]; // Mon-Sun

        let result = advance_workdays(start, days, &weekend_mask, &holidays);
        match result {
            Some(d) => {
                let serial = date_to_serial(&d);
                // Excel WORKDAY returns #NUM! when result date is before the epoch (serial < 1)
                if serial < 1.0 {
                    CellValue::error_with_message(
                        CellError::Num,
                        "WORKDAY: resulting date is before the epoch".to_string(),
                    )
                } else {
                    CellValue::number(serial)
                }
            }
            None => CellValue::error_with_message(
                CellError::Num,
                format!("WORKDAY: could not compute workday after advancing {days} days"),
            ),
        }
    }
}

pub struct FnWorkdayIntl;
impl PureFunction for FnWorkdayIntl {
    fn name(&self) -> &'static str {
        "WORKDAY.INTL"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn is_scalar_arg(&self, index: usize) -> bool {
        index < 3
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        let start_serial = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let days = match args[1].coerce_to_number() {
            Ok(n) => n as i32,
            Err(e) => return CellValue::Error(e, None),
        };

        let weekend_mask = if args.len() > 2 {
            parse_weekend_param(&args[2])
        } else {
            Ok([false, false, false, false, false, true, true])
        };
        let weekend_mask = match weekend_mask {
            Ok(m) => m,
            Err(e) => return CellValue::Error(e, None),
        };

        let holidays: Vec<f64> = if args.len() > 3 {
            let flat = flatten_values(&[args[3].clone()]);
            flat.iter()
                .filter_map(|v| v.coerce_to_number().ok())
                .map(|n| n.floor())
                .collect()
        } else {
            Vec::new()
        };

        let start = match serial_to_date(start_serial) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("WORKDAY.INTL: invalid start date serial number {start_serial}"),
                );
            }
        };

        let result = advance_workdays(start, days, &weekend_mask, &holidays);
        match result {
            Some(d) => {
                let serial = date_to_serial(&d);
                // Excel WORKDAY.INTL returns #NUM! when result date is before the epoch
                if serial < 1.0 {
                    CellValue::error_with_message(
                        CellError::Num,
                        "WORKDAY.INTL: resulting date is before the epoch".to_string(),
                    )
                } else {
                    CellValue::number(serial)
                }
            }
            None => CellValue::error_with_message(
                CellError::Num,
                format!("WORKDAY.INTL: could not compute workday after advancing {days} days"),
            ),
        }
    }
}

pub struct FnYearFrac;
impl PureFunction for FnYearFrac {
    fn name(&self) -> &'static str {
        "YEARFRAC"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        let start_serial = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let end_serial = match args[1].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let basis = if args.len() > 2 {
            match args[2].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };

        let (s_serial, e_serial) = if start_serial <= end_serial {
            (start_serial, end_serial)
        } else {
            (end_serial, start_serial)
        };

        let start = match serial_to_date(s_serial) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("YEARFRAC: invalid start date serial number {s_serial}"),
                );
            }
        };
        let end = match serial_to_date(e_serial) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("YEARFRAC: invalid end date serial number {e_serial}"),
                );
            }
        };

        let result = match basis {
            0 => {
                // US (NASD) 30/360
                let mut sd = start.day() as i32;
                let sm = start.month() as i32;
                let sy = start.year();
                let mut ed = end.day() as i32;
                let em = end.month() as i32;
                let ey = end.year();

                if sd == 31 {
                    sd = 30;
                }
                if ed == 31 && sd >= 30 {
                    ed = 30;
                }

                let days = (ey - sy) * 360 + (em - sm) * 30 + (ed - sd);
                days as f64 / 360.0
            }
            1 => {
                // Actual/actual
                let actual_days = (end - start).num_days() as f64;
                let avg_year = year_length_actual(start, end);
                actual_days / avg_year
            }
            2 => {
                // Actual/360
                let actual_days = (end - start).num_days() as f64;
                actual_days / 360.0
            }
            3 => {
                // Actual/365
                let actual_days = (end - start).num_days() as f64;
                actual_days / 365.0
            }
            4 => {
                // European 30/360
                let mut sd = start.day() as i32;
                let sm = start.month() as i32;
                let sy = start.year();
                let mut ed = end.day() as i32;
                let em = end.month() as i32;
                let ey = end.year();

                if sd == 31 {
                    sd = 30;
                }
                if ed == 31 {
                    ed = 30;
                }

                let days = (ey - sy) * 360 + (em - sm) * 30 + (ed - sd);
                days as f64 / 360.0
            }
            _ => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("YEARFRAC: invalid basis {basis}, expected 0-4"),
                );
            }
        };

        CellValue::number(result)
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn add_months(date: NaiveDate, months: i32) -> Option<NaiveDate> {
    let total_months = date.year() * 12 + date.month0() as i32 + months;
    let new_year = total_months.div_euclid(12);
    let new_month = (total_months.rem_euclid(12) + 1) as u32;
    let max_day = last_day_of_month(new_year, new_month);
    let new_day = date.day().min(max_day);
    NaiveDate::from_ymd_opt(new_year, new_month, new_day)
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

/// Parse the weekend parameter for NETWORKDAYS.INTL and WORKDAY.INTL.
/// Returns a [bool; 7] where index 0=Monday, 6=Sunday. true = weekend (non-working).
fn parse_weekend_param(val: &CellValue) -> Result<[bool; 7], CellError> {
    // Try as string first (7-char "0100000" format)
    if let Ok(s) = val.coerce_to_string()
        && s.len() == 7
        && s.chars().all(|c| c == '0' || c == '1')
    {
        let mut mask = [false; 7];
        for (i, ch) in s.chars().enumerate() {
            mask[i] = ch == '1';
        }
        return Ok(mask);
    }

    // Try as number
    match val.coerce_to_number() {
        Ok(n) => {
            let code = n as i32;
            // Excel NETWORKDAYS.INTL weekend codes:
            // [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
            let mask = match code {
                1 => [false, false, false, false, false, true, true], // Saturday, Sunday
                2 => [true, false, false, false, false, false, true], // Sunday, Monday
                3 => [true, true, false, false, false, false, false], // Monday, Tuesday
                4 => [false, true, true, false, false, false, false], // Tuesday, Wednesday
                5 => [false, false, true, true, false, false, false], // Wednesday, Thursday
                6 => [false, false, false, true, true, false, false], // Thursday, Friday
                7 => [false, false, false, false, true, true, false], // Friday, Saturday
                11 => [false, false, false, false, false, false, true], // Sunday only
                12 => [true, false, false, false, false, false, false], // Monday only
                13 => [false, true, false, false, false, false, false], // Tuesday only
                14 => [false, false, true, false, false, false, false], // Wednesday only
                15 => [false, false, false, true, false, false, false], // Thursday only
                16 => [false, false, false, false, true, false, false], // Friday only
                17 => [false, false, false, false, false, true, false], // Saturday only
                _ => return Err(CellError::Num),
            };
            Ok(mask)
        }
        Err(e) => Err(e),
    }
}

/// Advance by N workdays from a start date, skipping weekends and holidays.
/// Positive days = forward, negative = backward.
/// Uses Excel serial numbers directly to handle the Lotus 1-2-3 bug correctly.
fn advance_workdays(
    start: NaiveDate,
    days: i32,
    weekend_mask: &[bool; 7],
    holidays: &[f64],
) -> Option<NaiveDate> {
    if days == 0 {
        return Some(start);
    }
    let step: i64 = if days > 0 { 1 } else { -1 };
    let mut remaining = days.abs();
    let mut current_serial = date_to_serial(&start).floor() as i64;

    // Safety limit to prevent infinite loops
    let max_iterations = remaining as i64 * 3 + 1000;
    let mut iterations = 0i64;

    while remaining > 0 {
        current_serial += step;
        iterations += 1;
        if iterations > max_iterations {
            return None;
        }

        // Use Excel's serial-based DOW for weekend detection to handle
        // the Lotus 1-2-3 bug correctly for serials 1-59.
        if let Some(dow) = excel_dow_from_serial(current_serial as f64) {
            // dow: 0=Sun, 1=Mon, ..., 6=Sat
            // mask: 0=Mon, 1=Tue, ..., 5=Sat, 6=Sun
            let mask_idx = if dow == 0 { 6 } else { (dow - 1) as usize };
            if !weekend_mask[mask_idx] {
                let s = current_serial as f64;
                if !holidays.iter().any(|&h| (h - s).abs() < 0.5) {
                    remaining -= 1;
                }
            }
        }
    }
    serial_to_date(current_serial as f64)
}

/// Compute ISO 8601 week number from an Excel serial number.
///
/// This uses Excel's serial-based day-of-week calculation to handle the
/// Lotus 1-2-3 bug correctly for serials 1-59. The ISO week algorithm
/// finds the Thursday of the current week, then counts weeks from Jan 1
/// of that Thursday's year.
fn excel_iso_week_from_serial(serial: f64) -> u32 {
    let days = serial.floor() as i64;
    if days < 1 {
        return 1; // fallback
    }

    // Excel DOW: 0=Sun, 1=Mon, ..., 6=Sat
    let dow = (days - 1).rem_euclid(7); // 0=Sun, 1=Mon, ..., 6=Sat

    // Convert to ISO day: Mon=1, Tue=2, ..., Sun=7
    let iso_day = if dow == 0 { 7 } else { dow };

    // Find Thursday of the same ISO week: serial + (4 - iso_day)
    let thu_serial = days + (4 - iso_day);

    // If Thursday's serial is before serial 1 (before the Excel epoch), this
    // means the date falls in an ISO week belonging to a "previous year" in
    // Excel's calendar. In Excel's world, serial 1 = Sunday, Jan 1, 1900.
    // The ISO week containing that Sunday has its Thursday on serial 1 + (4-7) = -2,
    // which is before the epoch. Excel treats this as week 52 of the "previous year".
    if thu_serial < 1 {
        // This only happens for the very first few days (serial 1-3, which are
        // Sun-Tue in Excel's calendar). Their ISO Thursday falls before the epoch.
        // Excel returns 52 for these dates (last week of "previous year").
        return 52;
    }

    // Convert Thursday's serial to a date to get its year
    let thu_date = match serial_to_date(thu_serial as f64) {
        Some(d) => d,
        None => return 1, // fallback
    };

    let thu_year = thu_date.year();

    // Find Jan 1 of the Thursday's year and its serial
    let jan1 = NaiveDate::from_ymd_opt(thu_year, 1, 1)
        .expect("Jan 1 of a year from a valid NaiveDate is always valid");
    let jan1_serial = date_to_serial(&jan1) as i64;

    // Find the Thursday of the week containing Jan 1
    let jan1_dow = ((jan1_serial - 1).rem_euclid(7)) as i64;
    let jan1_iso_day = if jan1_dow == 0 { 7 } else { jan1_dow };
    let jan1_thu = jan1_serial + (4 - jan1_iso_day);

    // Week number = (thu_serial - jan1_thu) / 7 + 1

    ((thu_serial - jan1_thu) / 7 + 1) as u32
}

/// Calculate average year length for YEARFRAC basis 1 (actual/actual).
fn year_length_actual(start: NaiveDate, end: NaiveDate) -> f64 {
    let sy = start.year();
    let ey = end.year();
    if sy == ey {
        if is_leap_year(sy) { 366.0 } else { 365.0 }
    } else {
        // Average year length across the years spanned
        let mut total = 0.0;
        let mut count = 0;
        for y in sy..=ey {
            total += if is_leap_year(y) { 366.0 } else { 365.0 };
            count += 1;
        }
        total / count as f64
    }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

pub fn register(registry: &mut FunctionRegistry) {
    // Construction / Extraction
    registry.register(Box::new(FnDate));
    registry.register(Box::new(FnEpochToDate));
    registry.register(Box::new(FnYear));
    registry.register(Box::new(FnMonth));
    registry.register(Box::new(FnDay));
    registry.register(Box::new(FnHour));
    registry.register(Box::new(FnMinute));
    registry.register(Box::new(FnSecond));
    registry.register(Box::new(FnDatevalue));

    // Arithmetic
    registry.register(Box::new(FnEdate));
    registry.register(Box::new(FnEomonth));
    registry.register(Box::new(FnWeekday));
    registry.register(Box::new(FnDatedif));
    registry.register(Box::new(FnDays));
    registry.register(Box::new(FnNetworkdays));

    // Additional date/time functions
    registry.register(Box::new(FnDays360));
    registry.register(Box::new(FnIsoWeekNum));
    registry.register(Box::new(FnNetworkdaysIntl));
    registry.register(Box::new(FnTime));
    registry.register(Box::new(FnTimeValue));
    registry.register(Box::new(FnWeekNum));
    registry.register(Box::new(FnWorkday));
    registry.register(Box::new(FnWorkdayIntl));
    registry.register(Box::new(FnYearFrac));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::CellControl;

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }
    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }
    fn err(e: CellError) -> CellValue {
        CellValue::Error(e, None)
    }
    fn bool_val(b: bool) -> CellValue {
        CellValue::Boolean(b)
    }
    fn null() -> CellValue {
        CellValue::Null
    }
    fn control(b: bool) -> CellValue {
        CellValue::Control(CellControl::checkbox(b))
    }
    fn assert_num_close(value: CellValue, expected: f64) {
        match value {
            CellValue::Number(n) => {
                assert!(
                    (n.get() - expected).abs() < 1e-9,
                    "expected {expected}, got {}",
                    n.get()
                );
            }
            other => panic!("Expected number {expected}, got {other:?}"),
        }
    }

    #[test]
    fn test_serial_date_roundtrip() {
        // 2024-01-15 should be serial 45306
        let d = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let serial = date_to_serial(&d);
        let back = serial_to_date(serial).unwrap();
        assert_eq!(d, back);
    }

    #[test]
    fn test_serial_date_known_values() {
        // 1900-01-01 = day 1
        let d1 = NaiveDate::from_ymd_opt(1900, 1, 1).unwrap();
        assert_eq!(date_to_serial(&d1), 1.0);

        // 1900-03-01 = day 61 (after the fake Feb 29)
        let d61 = NaiveDate::from_ymd_opt(1900, 3, 1).unwrap();
        assert_eq!(date_to_serial(&d61), 61.0);

        // 2000-01-01 = day 36526
        let d2000 = NaiveDate::from_ymd_opt(2000, 1, 1).unwrap();
        assert_eq!(date_to_serial(&d2000), 36526.0);
    }

    #[test]
    fn test_epochtodate_direct_examples() {
        let f = FnEpochToDate;
        assert_eq!(f.call(&[num(0.0)]), num(25569.0));
        assert_eq!(f.call(&[num(86400.0)]), num(25570.0));
        assert_num_close(f.call(&[num(1655906710.0)]), 44_734.586_921_296_29);
        assert_num_close(f.call(&[num(1655906568893.0), num(2.0)]), 44734.58528811343);
        assert_num_close(
            f.call(&[num(1656356678000410.0), num(3.0)]),
            44739.79488425926,
        );
        assert_num_close(f.call(&[num(1.0), num(1.9)]), 25569.000011574073);
        assert_eq!(f.call(&[num(1.0), num(0.9)]), err(CellError::Num));
        assert_eq!(f.call(&[text("x")]), err(CellError::Value));
        assert_eq!(f.call(&[num(-1.0)]), err(CellError::Num));
        assert_eq!(f.call(&[num(1.0), num(4.0)]), err(CellError::Num));
    }

    #[test]
    fn test_epochtodate_direct_scalar_coercions() {
        let f = FnEpochToDate;
        assert_num_close(f.call(&[bool_val(true)]), 25569.000011574073);
        assert_eq!(f.call(&[bool_val(false)]), num(25569.0));
        assert_eq!(f.call(&[null()]), num(25569.0));
        assert_num_close(f.call(&[control(true)]), 25569.000011574073);
        assert_num_close(f.call(&[text("1")]), 25569.000011574073);
        assert_eq!(f.call(&[text("")]), err(CellError::Value));

        let date_like = f.call(&[text("2020-01-01")]);
        assert_num_close(date_like, 43831.0 / 86400.0 + 25569.0);
    }

    #[test]
    fn test_epochtodate_registry_lookup_case_prefix_and_array_lift() {
        let reg = crate::FunctionRegistry::new();
        let (_, f) = reg
            .get_by_name("EPOCHTODATE")
            .expect("EPOCHTODATE registered");
        assert_eq!(f.min_args(), 1);
        assert_eq!(f.max_args(), Some(2));

        assert_eq!(reg.call("epochtodate", &[num(0.0)]), num(25569.0));
        assert_eq!(reg.call("EpochToDate", &[num(86400.0)]), num(25570.0));
        assert_eq!(reg.call("_xlfn.EPOCHTODATE", &[num(0.0)]), num(25569.0));
        assert_eq!(
            reg.call("_xlfn._xlws.EPOCHTODATE", &[num(0.0)]),
            num(25569.0)
        );

        let result = reg.call(
            "EPOCHTODATE",
            &[CellValue::from_rows(vec![vec![num(0.0), num(86400.0)]])],
        );
        assert_eq!(
            result,
            CellValue::from_rows(vec![vec![num(25569.0), num(25570.0)]])
        );
    }

    #[test]
    fn test_date_function() {
        let f = FnDate;
        // DATE(2024, 1, 15)
        let serial = f.call(&[num(2024.0), num(1.0), num(15.0)]);
        if let CellValue::Number(n) = serial {
            let d = serial_to_date(n.get()).unwrap();
            assert_eq!(d, NaiveDate::from_ymd_opt(2024, 1, 15).unwrap());
        } else {
            panic!("Expected number");
        }
    }

    #[test]
    fn test_date_overflow_month() {
        let f = FnDate;
        // DATE(2024, 13, 1) = DATE(2025, 1, 1)
        let serial = f.call(&[num(2024.0), num(13.0), num(1.0)]);
        if let CellValue::Number(n) = serial {
            let d = serial_to_date(n.get()).unwrap();
            assert_eq!(d, NaiveDate::from_ymd_opt(2025, 1, 1).unwrap());
        } else {
            panic!("Expected number");
        }
    }

    #[test]
    fn test_year_month_day() {
        // 2024-01-15
        let d = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let serial = num(date_to_serial(&d));
        assert_eq!(FnYear.call(std::slice::from_ref(&serial)), num(2024.0));
        assert_eq!(FnMonth.call(std::slice::from_ref(&serial)), num(1.0));
        assert_eq!(FnDay.call(&[serial]), num(15.0));
    }

    #[test]
    fn test_hour_minute_second() {
        // 12:30:45 PM = 0.521354...
        let time = 0.5 + 30.0 / 1440.0 + 45.0 / 86400.0;
        let serial = num(45000.0 + time);
        assert_eq!(FnHour.call(std::slice::from_ref(&serial)), num(12.0));
        assert_eq!(FnMinute.call(std::slice::from_ref(&serial)), num(30.0));
        assert_eq!(FnSecond.call(&[serial]), num(45.0));
    }

    #[test]
    fn test_edate() {
        let f = FnEdate;
        // 2024-01-31 + 1 month = 2024-02-29 (leap year)
        let jan31 = NaiveDate::from_ymd_opt(2024, 1, 31).unwrap();
        let serial = num(date_to_serial(&jan31));
        let result = f.call(&[serial, num(1.0)]);
        if let CellValue::Number(n) = result {
            let d = serial_to_date(n.get()).unwrap();
            assert_eq!(d, NaiveDate::from_ymd_opt(2024, 2, 29).unwrap());
        } else {
            panic!("Expected number");
        }
    }

    #[test]
    fn test_eomonth() {
        let f = FnEomonth;
        let jan15 = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let serial = num(date_to_serial(&jan15));
        let result = f.call(&[serial, num(0.0)]);
        if let CellValue::Number(n) = result {
            let d = serial_to_date(n.get()).unwrap();
            assert_eq!(d, NaiveDate::from_ymd_opt(2024, 1, 31).unwrap());
        } else {
            panic!("Expected number");
        }
    }

    #[test]
    fn test_weekday() {
        let f = FnWeekday;
        // 2024-01-15 is a Monday
        let mon = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let serial = num(date_to_serial(&mon));
        assert_eq!(f.call(std::slice::from_ref(&serial)), num(2.0)); // type 1: Mon=2
        assert_eq!(f.call(&[serial.clone(), num(2.0)]), num(1.0)); // type 2: Mon=1
    }

    #[test]
    fn test_datedif_years() {
        let f = FnDatedif;
        let start = NaiveDate::from_ymd_opt(2020, 1, 15).unwrap();
        let end = NaiveDate::from_ymd_opt(2024, 3, 20).unwrap();
        let s = num(date_to_serial(&start));
        let e = num(date_to_serial(&end));
        assert_eq!(f.call(&[s.clone(), e.clone(), text("Y")]), num(4.0));
        assert_eq!(f.call(&[s.clone(), e.clone(), text("M")]), num(50.0));
    }

    #[test]
    fn test_datedif_start_after_end() {
        let f = FnDatedif;
        assert_eq!(
            f.call(&[num(45000.0), num(44000.0), text("D")]),
            err(CellError::Num)
        );
    }

    #[test]
    fn test_datedif_serial_zero() {
        let f = FnDatedif;
        // Serial 0 = "Jan 0, 1900" (mapped to Dec 31, 1899)
        // Serial 45000 ≈ Feb 18, 2023
        // DATEDIF(0, 45000, "Y") should work, not #NUM!
        let result = f.call(&[num(0.0), num(45000.0), text("Y")]);
        assert!(
            matches!(result, CellValue::Number(_)),
            "Expected number, got {:?}",
            result
        );

        // "D" unit (already works via serial arithmetic)
        assert_eq!(f.call(&[num(0.0), num(1.0), text("D")]), num(1.0));

        // "M" unit
        let result = f.call(&[num(0.0), num(45000.0), text("M")]);
        assert!(
            matches!(result, CellValue::Number(_)),
            "Expected number for M, got {:?}",
            result
        );

        // All units should NOT return #NUM!
        for unit in &["Y", "M", "D", "MD", "YM", "YD"] {
            let result = f.call(&[num(0.0), num(45000.0), text(unit)]);
            assert!(
                !matches!(result, CellValue::Error(..)),
                "DATEDIF(0, 45000, \"{}\") returned error: {:?}",
                unit,
                result
            );
        }
    }

    #[test]
    fn test_days() {
        let f = FnDays;
        // DAYS(end, start) = end - start
        let start = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let end = NaiveDate::from_ymd_opt(2024, 1, 31).unwrap();
        let s = num(date_to_serial(&start));
        let e = num(date_to_serial(&end));
        assert_eq!(f.call(&[e, s]), num(30.0));
    }

    #[test]
    fn test_datevalue() {
        let f = FnDatevalue;
        let result = f.call(&[text("2024-01-15")]);
        if let CellValue::Number(n) = result {
            let d = serial_to_date(n.get()).unwrap();
            assert_eq!(d, NaiveDate::from_ymd_opt(2024, 1, 15).unwrap());
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_datevalue_invalid() {
        let f = FnDatevalue;
        assert_eq!(f.call(&[text("not a date")]), err(CellError::Value));
    }

    #[test]
    fn test_datevalue_datetime_strips_time() {
        // Excel: DATEVALUE("01/30/2026 03:50 PM") = 46052 (date only, time discarded)
        let f = FnDatevalue;
        let result = f.call(&[text("01/30/2026 03:50 PM")]);
        if let CellValue::Number(n) = result {
            assert_eq!(n.get(), 46052.0);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_datevalue_datetime_24h_strips_time() {
        let f = FnDatevalue;
        let result = f.call(&[text("01/30/2026 15:50")]);
        if let CellValue::Number(n) = result {
            assert_eq!(n.get(), 46052.0);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_networkdays() {
        let f = FnNetworkdays;
        // Mon Jan 1 to Fri Jan 5, 2024 = 5 working days
        let mon = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let fri = NaiveDate::from_ymd_opt(2024, 1, 5).unwrap();
        assert_eq!(
            f.call(&[num(date_to_serial(&mon)), num(date_to_serial(&fri))]),
            num(5.0)
        );
    }

    #[test]
    fn test_networkdays_same_day_weekend() {
        let f = FnNetworkdays;
        // Saturday Jan 6, 2024 to itself = 0 (it's a weekend)
        let sat = NaiveDate::from_ymd_opt(2024, 1, 6).unwrap();
        let sat_serial = date_to_serial(&sat);
        assert_eq!(f.call(&[num(sat_serial), num(sat_serial)]), num(0.0));

        // Sunday Jan 7, 2024 to itself = 0 (it's a weekend)
        let sun = NaiveDate::from_ymd_opt(2024, 1, 7).unwrap();
        let sun_serial = date_to_serial(&sun);
        assert_eq!(f.call(&[num(sun_serial), num(sun_serial)]), num(0.0));

        // Monday Jan 8, 2024 to itself = 1 (it's a workday)
        let mon = NaiveDate::from_ymd_opt(2024, 1, 8).unwrap();
        let mon_serial = date_to_serial(&mon);
        assert_eq!(f.call(&[num(mon_serial), num(mon_serial)]), num(1.0));
    }

    // -----------------------------------------------------------------------
    // Additional datetime function tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_days360_us() {
        let f = FnDays360;
        // Jan 30 to Feb 28, 2024 (US method)
        let start = NaiveDate::from_ymd_opt(2024, 1, 30).unwrap();
        let end = NaiveDate::from_ymd_opt(2024, 2, 28).unwrap();
        let result = f.call(&[num(date_to_serial(&start)), num(date_to_serial(&end))]);
        if let CellValue::Number(n) = result {
            // 30/360: (0*360) + (1*30) + (28-30) = 28
            assert_eq!(n.get(), 28.0);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_days360_european() {
        let f = FnDays360;
        let start = NaiveDate::from_ymd_opt(2024, 1, 31).unwrap();
        let end = NaiveDate::from_ymd_opt(2024, 3, 31).unwrap();
        let result = f.call(&[
            num(date_to_serial(&start)),
            num(date_to_serial(&end)),
            bool_val(true),
        ]);
        if let CellValue::Number(n) = result {
            // European: both 31->30. (0*360) + (2*30) + (30-30) = 60
            assert_eq!(n.get(), 60.0);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_isoweeknum() {
        let f = FnIsoWeekNum;
        // 2024-01-01 is Monday, ISO week 1
        let d = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        assert_eq!(f.call(&[num(date_to_serial(&d))]), num(1.0));
        // 2024-12-30 is Monday of ISO week 1 of 2025
        let d2 = NaiveDate::from_ymd_opt(2024, 12, 30).unwrap();
        assert_eq!(f.call(&[num(date_to_serial(&d2))]), num(1.0));
    }

    #[test]
    fn test_isoweeknum_year_end() {
        let f = FnIsoWeekNum;
        // 2020-12-31 is Thursday, ISO week 53
        let d = NaiveDate::from_ymd_opt(2020, 12, 31).unwrap();
        assert_eq!(f.call(&[num(date_to_serial(&d))]), num(53.0));
        // 2021-01-01 is Friday, still ISO week 53 of 2020
        let d2 = NaiveDate::from_ymd_opt(2021, 1, 1).unwrap();
        assert_eq!(f.call(&[num(date_to_serial(&d2))]), num(53.0));
        // 2019-12-28 is Saturday, ISO week 52
        let d3 = NaiveDate::from_ymd_opt(2019, 12, 28).unwrap();
        assert_eq!(f.call(&[num(date_to_serial(&d3))]), num(52.0));
    }

    #[test]
    fn test_time() {
        let f = FnTime;
        // TIME(12, 30, 45) = 0.5 + 30/1440 + 45/86400
        let result = f.call(&[num(12.0), num(30.0), num(45.0)]);
        if let CellValue::Number(n) = result {
            let expected = (12.0 * 3600.0 + 30.0 * 60.0 + 45.0) / 86400.0;
            assert!((n.get() - expected).abs() < 1e-10);
        } else {
            panic!("Expected number");
        }
    }

    #[test]
    fn test_time_zero() {
        let f = FnTime;
        let result = f.call(&[num(0.0), num(0.0), num(0.0)]);
        assert_eq!(result, num(0.0));
    }

    #[test]
    fn test_timevalue() {
        let f = FnTimeValue;
        let result = f.call(&[text("12:30:45")]);
        if let CellValue::Number(n) = result {
            let expected = (12.0 * 3600.0 + 30.0 * 60.0 + 45.0) / 86400.0;
            assert!((n.get() - expected).abs() < 1e-10);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_timevalue_invalid() {
        let f = FnTimeValue;
        assert_eq!(f.call(&[text("not a time")]), err(CellError::Value));
    }

    #[test]
    fn test_weeknum_sunday_start() {
        let f = FnWeekNum;
        // 2024-01-01 is Monday. Week 1 starts Sunday Dec 31, 2023.
        // So Jan 1 2024 is in week 1 with Sunday start (return_type=1).
        let d = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let result = f.call(&[num(date_to_serial(&d)), num(1.0)]);
        assert_eq!(result, num(1.0));
    }

    #[test]
    fn test_weeknum_iso() {
        let f = FnWeekNum;
        // ISO week: return_type=21
        let d = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let result = f.call(&[num(date_to_serial(&d)), num(21.0)]);
        assert_eq!(result, num(1.0));
    }

    #[test]
    fn test_weeknum_iso_year_end() {
        let f = FnWeekNum;
        // ISO week: return_type=21
        // 2019-12-28 is Saturday, ISO week 52
        let d = NaiveDate::from_ymd_opt(2019, 12, 28).unwrap();
        let result = f.call(&[num(date_to_serial(&d)), num(21.0)]);
        assert_eq!(result, num(52.0));
        // 2020-12-31 is Thursday, ISO week 53
        let d2 = NaiveDate::from_ymd_opt(2020, 12, 31).unwrap();
        let result2 = f.call(&[num(date_to_serial(&d2)), num(21.0)]);
        assert_eq!(result2, num(53.0));
    }

    #[test]
    fn test_workday() {
        let f = FnWorkday;
        // Start Monday 2024-01-01, add 5 workdays = Monday 2024-01-08
        // (Tue 2, Wed 3, Thu 4, Fri 5, skip Sat/Sun, Mon 8)
        let start = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let result = f.call(&[num(date_to_serial(&start)), num(5.0)]);
        if let CellValue::Number(n) = result {
            let d = serial_to_date(n.get()).unwrap();
            assert_eq!(d, NaiveDate::from_ymd_opt(2024, 1, 8).unwrap());
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_workday_skips_weekend() {
        let f = FnWorkday;
        // Start Friday 2024-01-05, add 1 workday = Monday 2024-01-08
        let start = NaiveDate::from_ymd_opt(2024, 1, 5).unwrap();
        let result = f.call(&[num(date_to_serial(&start)), num(1.0)]);
        if let CellValue::Number(n) = result {
            let d = serial_to_date(n.get()).unwrap();
            assert_eq!(d, NaiveDate::from_ymd_opt(2024, 1, 8).unwrap());
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_workday_negative() {
        let f = FnWorkday;
        // Start Monday 2024-01-08, subtract 1 workday = Friday 2024-01-05
        let start = NaiveDate::from_ymd_opt(2024, 1, 8).unwrap();
        let result = f.call(&[num(date_to_serial(&start)), num(-1.0)]);
        if let CellValue::Number(n) = result {
            let d = serial_to_date(n.get()).unwrap();
            assert_eq!(d, NaiveDate::from_ymd_opt(2024, 1, 5).unwrap());
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_workday_before_epoch_returns_error() {
        let f = FnWorkday;
        // Start from Jan 1, 1900 (serial 1), go back 1 workday -> before epoch -> #NUM!
        let result = f.call(&[num(1.0), num(-1.0)]);
        assert_eq!(result, err(CellError::Num));

        // Start from a date early in 1900, go back many workdays -> before epoch -> #NUM!
        let start = NaiveDate::from_ymd_opt(1900, 1, 10).unwrap();
        let result = f.call(&[num(date_to_serial(&start)), num(-252.0)]);
        assert_eq!(result, err(CellError::Num));
    }

    #[test]
    fn test_workday_intl() {
        let f = FnWorkdayIntl;
        // Same as workday test but with explicit weekend code 1
        let start = NaiveDate::from_ymd_opt(2024, 1, 5).unwrap();
        let result = f.call(&[num(date_to_serial(&start)), num(1.0), num(1.0)]);
        if let CellValue::Number(n) = result {
            let d = serial_to_date(n.get()).unwrap();
            assert_eq!(d, NaiveDate::from_ymd_opt(2024, 1, 8).unwrap());
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_networkdays_intl() {
        let f = FnNetworkdaysIntl;
        // Mon Jan 1 to Fri Jan 5, 2024 = 5 working days (standard weekend)
        let mon = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let fri = NaiveDate::from_ymd_opt(2024, 1, 5).unwrap();
        assert_eq!(
            f.call(&[
                num(date_to_serial(&mon)),
                num(date_to_serial(&fri)),
                num(1.0)
            ],),
            num(5.0)
        );
    }

    #[test]
    fn test_yearfrac_us_30_360() {
        let f = FnYearFrac;
        // Jan 1 to Jul 1, 2024 = exactly 0.5 year in 30/360
        let start = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let end = NaiveDate::from_ymd_opt(2024, 7, 1).unwrap();
        let result = f.call(&[
            num(date_to_serial(&start)),
            num(date_to_serial(&end)),
            num(0.0),
        ]);
        if let CellValue::Number(n) = result {
            assert!((n.get() - 0.5).abs() < 1e-10);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_yearfrac_actual_365() {
        let f = FnYearFrac;
        // Jan 1 to Dec 31, 2024: 365 days / 365 = 1.0 (basis 3, actual/365)
        let start = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let end = NaiveDate::from_ymd_opt(2024, 12, 31).unwrap();
        let result = f.call(&[
            num(date_to_serial(&start)),
            num(date_to_serial(&end)),
            num(3.0),
        ]);
        if let CellValue::Number(n) = result {
            // 365 days (Jan 1 to Dec 31) / 365 = 1.0
            assert!((n.get() - 365.0 / 365.0).abs() < 1e-10);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_yearfrac_invalid_basis() {
        let f = FnYearFrac;
        let start = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let end = NaiveDate::from_ymd_opt(2024, 7, 1).unwrap();
        assert_eq!(
            f.call(&[
                num(date_to_serial(&start)),
                num(date_to_serial(&end)),
                num(5.0)
            ],),
            err(CellError::Num)
        );
    }

    // -----------------------------------------------------------------------
    // Serial 60 (Lotus 1-2-3 bug: fictional Feb 29, 1900) tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_serial_0_year_month_day() {
        // Serial 0 = "January 0, 1900" (Excel quirk)
        assert_eq!(FnYear.call(&[num(0.0)]), num(1900.0));
        assert_eq!(FnMonth.call(&[num(0.0)]), num(1.0));
        assert_eq!(FnDay.call(&[num(0.0)]), num(0.0));
    }

    #[test]
    fn test_serial_negative_year_month_day() {
        // Negative serials should return #NUM!
        assert!(matches!(
            FnYear.call(&[num(-1.0)]),
            CellValue::Error(CellError::Num, _)
        ));
        assert!(matches!(
            FnMonth.call(&[num(-1.0)]),
            CellValue::Error(CellError::Num, _)
        ));
        assert!(matches!(
            FnDay.call(&[num(-1.0)]),
            CellValue::Error(CellError::Num, _)
        ));
    }

    #[test]
    fn test_serial_60_year_month_day() {
        // Serial 60 = fictional Feb 29, 1900
        assert_eq!(FnYear.call(&[num(60.0)]), num(1900.0));
        assert_eq!(FnMonth.call(&[num(60.0)]), num(2.0));
        assert_eq!(FnDay.call(&[num(60.0)]), num(29.0));
    }

    #[test]
    fn test_serial_61_year_month_day() {
        // Serial 61 = March 1, 1900 (first real date after the fake leap day)
        assert_eq!(FnYear.call(&[num(61.0)]), num(1900.0));
        assert_eq!(FnMonth.call(&[num(61.0)]), num(3.0));
        assert_eq!(FnDay.call(&[num(61.0)]), num(1.0));
    }

    // -----------------------------------------------------------------------
    // DAYS360 US method with February end-of-month
    // -----------------------------------------------------------------------

    #[test]
    fn test_days360_us_feb_end_of_month() {
        let f = FnDays360;
        // DAYS360("2024-01-31", "2024-02-29", FALSE) -- US method
        // Start: Jan 31 (last day of Jan) -> sd=31, rule 3: sd=30
        // End: Feb 29 (last day of Feb) -> ed=29, not rule 2 (start not Feb), not rule 4
        // Result: (0*360) + (1*30) + (29-30) = 29
        let start = NaiveDate::from_ymd_opt(2024, 1, 31).unwrap();
        let end = NaiveDate::from_ymd_opt(2024, 2, 29).unwrap();
        let result = f.call(&[
            num(date_to_serial(&start)),
            num(date_to_serial(&end)),
            bool_val(false),
        ]);
        if let CellValue::Number(n) = result {
            assert_eq!(n.get(), 29.0);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_days360_us_feb_to_feb() {
        let f = FnDays360;
        // DAYS360("2024-02-29", "2025-02-28", FALSE) -- both start and end are last day of Feb
        // Start: Feb 29, 2024 (last day of Feb, leap year) -> rule 1: sd=30
        // End: Feb 28, 2025 (last day of Feb, non-leap year) -> rule 2: ed=30
        // Result: (1*360) + (0*30) + (30-30) = 360
        let start = NaiveDate::from_ymd_opt(2024, 2, 29).unwrap();
        let end = NaiveDate::from_ymd_opt(2025, 2, 28).unwrap();
        let result = f.call(&[
            num(date_to_serial(&start)),
            num(date_to_serial(&end)),
            bool_val(false),
        ]);
        if let CellValue::Number(n) = result {
            assert_eq!(n.get(), 360.0);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    // -----------------------------------------------------------------------
    // WEEKDAY return types 11-17
    // -----------------------------------------------------------------------

    #[test]
    fn test_weekday_return_types_11_to_17() {
        let f = FnWeekday;
        // 2024-01-15 is a Monday (dow_sun=1)
        let mon = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let serial = num(date_to_serial(&mon));

        // Type 11: Mon=1..Sun=7
        assert_eq!(f.call(&[serial.clone(), num(11.0)]), num(1.0));
        // Type 12: Tue=1..Mon=7 -> Mon=7
        assert_eq!(f.call(&[serial.clone(), num(12.0)]), num(7.0));
        // Type 13: Wed=1..Tue=7 -> Mon=6
        assert_eq!(f.call(&[serial.clone(), num(13.0)]), num(6.0));
        // Type 14: Thu=1..Wed=7 -> Mon=5
        assert_eq!(f.call(&[serial.clone(), num(14.0)]), num(5.0));
        // Type 15: Fri=1..Thu=7 -> Mon=4
        assert_eq!(f.call(&[serial.clone(), num(15.0)]), num(4.0));
        // Type 16: Sat=1..Fri=7 -> Mon=3
        assert_eq!(f.call(&[serial.clone(), num(16.0)]), num(3.0));
        // Type 17: Sun=1..Sat=7 -> Mon=2
        assert_eq!(f.call(&[serial.clone(), num(17.0)]), num(2.0));

        // Also test with Sunday (2024-01-14, dow_sun=0)
        let sun = NaiveDate::from_ymd_opt(2024, 1, 14).unwrap();
        let sun_serial = num(date_to_serial(&sun));
        // Type 11: Mon=1..Sun=7 -> Sun=7
        assert_eq!(f.call(&[sun_serial.clone(), num(11.0)]), num(7.0));
        // Type 17: Sun=1..Sat=7 -> Sun=1
        assert_eq!(f.call(&[sun_serial.clone(), num(17.0)]), num(1.0));
    }

    #[test]
    fn test_serial_to_date_roundtrip() {
        // Serial 1 = Jan 1, 1900
        let d1 = serial_to_date(1.0).unwrap();
        assert_eq!(d1, NaiveDate::from_ymd_opt(1900, 1, 1).unwrap());
        assert_eq!(date_to_serial(&d1), 1.0);

        // Serial 44927 = Jan 1, 2023 (Sunday)
        let d2 = serial_to_date(44927.0).unwrap();
        assert_eq!(d2, NaiveDate::from_ymd_opt(2023, 1, 1).unwrap());
        assert_eq!(date_to_serial(&d2), 44927.0);

        // Test the leap year boundary
        let d59 = serial_to_date(59.0).unwrap();
        assert_eq!(d59, NaiveDate::from_ymd_opt(1900, 2, 28).unwrap());

        let d61 = serial_to_date(61.0).unwrap();
        assert_eq!(d61, NaiveDate::from_ymd_opt(1900, 3, 1).unwrap());
    }

    #[test]
    fn test_weekday_sunday_serial_44927() {
        let f = FnWeekday;
        // Serial 44927 = Jan 1, 2023 (Sunday)
        // WEEKDAY(44927, 1) should be 1 (Sunday in type 1)
        assert_eq!(f.call(&[num(44927.0)]), num(1.0));
        // WEEKDAY(44927, 2) should be 7 (Sunday in type 2)
        assert_eq!(f.call(&[num(44927.0), num(2.0)]), num(7.0));
        // WEEKDAY(44927, 3) should be 6 (Sunday in type 3)
        assert_eq!(f.call(&[num(44927.0), num(3.0)]), num(6.0));
    }

    /// Test WEEKDAY for serial 1 (Jan 1, 1900) — the Lotus 1-2-3 bug boundary.
    /// Excel considers serial 1 = Sunday. Our old chrono-based code returned Monday.
    #[test]
    fn test_weekday_serial_1_lotus_bug() {
        let f = FnWeekday;
        // Serial 1 = Jan 1, 1900. Excel says Sunday (dow=0).
        // WEEKDAY(1, 1) = 1 (Sunday)
        assert_eq!(f.call(&[num(1.0)]), num(1.0));
        // WEEKDAY(1, 2) = 7 (Sunday)
        assert_eq!(f.call(&[num(1.0), num(2.0)]), num(7.0));
        // WEEKDAY(1, 3) = 6 (Sunday)
        assert_eq!(f.call(&[num(1.0), num(3.0)]), num(6.0));

        // Serial 2 = Jan 2, 1900. Excel says Monday (dow=1). Type 1: 2
        assert_eq!(f.call(&[num(2.0)]), num(2.0));

        // Serial 7 = Jan 7, 1900. Excel says Saturday (dow=6). Type 1: 7
        assert_eq!(f.call(&[num(7.0)]), num(7.0));

        // Serial 8 = Jan 8, 1900. Excel says Sunday (dow=0). Type 1: 1
        assert_eq!(f.call(&[num(8.0)]), num(1.0));

        // Serial 59 = Feb 28, 1900. (59-1)%7=58%7=2 => Tuesday (dow=2). Type 1: 3
        assert_eq!(f.call(&[num(59.0)]), num(3.0));

        // Serial 60 = fake Feb 29, 1900. (60-1)%7=59%7=3 => Wednesday (dow=3). Type 1: 4
        assert_eq!(f.call(&[num(60.0)]), num(4.0));

        // Serial 61 = Mar 1, 1900. (61-1)%7=60%7=4 => Thursday (dow=4). Type 1: 5
        // Real calendar: Mar 1, 1900 is Thursday. Aligned!
        assert_eq!(f.call(&[num(61.0)]), num(5.0));
    }

    /// Test DATE(1900, 2, 29) — the Lotus 1-2-3 fake leap day.
    /// Excel returns serial 60 for this date; our DATE function should too.
    #[test]
    fn test_date_fake_leap_day_1900() {
        let f = FnDate;
        let result = f.call(&[num(1900.0), num(2.0), num(29.0)]);
        // Excel: DATE(1900, 2, 29) = serial 60
        assert_eq!(
            result,
            num(60.0),
            "DATE(1900,2,29) should be serial 60 (Lotus bug)"
        );
    }

    /// Test DATE function near the Lotus bug boundary.
    #[test]
    fn test_date_near_lotus_boundary() {
        let f = FnDate;
        // DATE(1900, 2, 28) = serial 59
        assert_eq!(f.call(&[num(1900.0), num(2.0), num(28.0)]), num(59.0));
        // DATE(1900, 3, 1) = serial 61
        assert_eq!(f.call(&[num(1900.0), num(3.0), num(1.0)]), num(61.0));
        // DATE(1900, 1, 1) = serial 1
        assert_eq!(f.call(&[num(1900.0), num(1.0), num(1.0)]), num(1.0));
        // DATE(2023, 1, 1) = serial 44927
        assert_eq!(f.call(&[num(2023.0), num(1.0), num(1.0)]), num(44927.0));
        // DATE(1900, 2, 30) should overflow to Mar 1, serial 61
        assert_eq!(f.call(&[num(1900.0), num(2.0), num(30.0)]), num(61.0));
        // DATE(1900, 1, 60) should be serial 60 (the fake Feb 29)
        assert_eq!(f.call(&[num(1900.0), num(1.0), num(60.0)]), num(60.0));
    }

    #[test]
    fn test_serial_to_date_comprehensive() {
        // Verify serial-to-date for a range of well-known Excel dates
        use chrono::Weekday;

        // Serial 1 = Jan 1, 1900 (Monday)
        let d = serial_to_date(1.0).unwrap();
        assert_eq!(d.weekday(), Weekday::Mon);
        assert_eq!((d.year(), d.month(), d.day()), (1900, 1, 1));

        // Serial 2 = Jan 2, 1900 (Tuesday)
        let d = serial_to_date(2.0).unwrap();
        assert_eq!(d.weekday(), Weekday::Tue);
        assert_eq!((d.year(), d.month(), d.day()), (1900, 1, 2));

        // Serial 7 = Jan 7, 1900 (Sunday)
        let d = serial_to_date(7.0).unwrap();
        assert_eq!(d.weekday(), Weekday::Sun);
        assert_eq!((d.year(), d.month(), d.day()), (1900, 1, 7));

        // Serial 59 = Feb 28, 1900 (Wednesday)
        let d = serial_to_date(59.0).unwrap();
        assert_eq!(d.weekday(), Weekday::Wed);
        assert_eq!((d.year(), d.month(), d.day()), (1900, 2, 28));

        // Serial 61 = Mar 1, 1900 (Thursday)
        let d = serial_to_date(61.0).unwrap();
        assert_eq!(d.weekday(), Weekday::Thu);
        assert_eq!((d.year(), d.month(), d.day()), (1900, 3, 1));

        // Serial 44927 = Jan 1, 2023 (Sunday)
        let d = serial_to_date(44927.0).unwrap();
        assert_eq!(d.weekday(), Weekday::Sun);
        assert_eq!((d.year(), d.month(), d.day()), (2023, 1, 1));

        // Serial 44928 = Jan 2, 2023 (Monday)
        let d = serial_to_date(44928.0).unwrap();
        assert_eq!(d.weekday(), Weekday::Mon);
        assert_eq!((d.year(), d.month(), d.day()), (2023, 1, 2));

        // DATE(2024, 1, 15) serial should give Monday
        let d = serial_to_date(date_to_serial(
            &NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
        ))
        .unwrap();
        assert_eq!(d.weekday(), Weekday::Mon);

        // Verify WEEKDAY consistency: serial_to_date weekday matches Excel's WEEKDAY
        // for a range of known serials
        for serial in [1, 7, 44927, 44928, 44929, 44930, 44931, 44932, 44933] {
            let d = serial_to_date(serial as f64).unwrap();
            let dow = d.weekday().num_days_from_sunday() as i32;
            let weekday_type1 = dow + 1;
            // Verify it's in 1-7 range
            assert!(
                (1..=7).contains(&weekday_type1),
                "serial {} gave weekday_type1={}",
                serial,
                weekday_type1
            );
        }
    }
}

// ---------------------------------------------------------------------------
// NEW function structs added in this file:
//   FnDays360, FnIsoWeekNum, FnNetworkdaysIntl, FnTime, FnTimeValue,
//   FnWeekNum, FnWorkday, FnWorkdayIntl, FnYearFrac
// ---------------------------------------------------------------------------
