// ============================================================================
// Helper Functions
// ============================================================================

/// Generate a GUID in standard format: {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}
pub fn generate_guid() -> String {
    // Simple pseudo-random GUID based on time and a counter
    // In production, you'd want a proper UUID library
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    let timestamp = standalone_unix_nanos() as u64;

    let counter = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

    // Mix timestamp and counter for uniqueness
    let a = (timestamp & 0xFFFFFFFF) as u32;
    let b = ((timestamp >> 32) & 0xFFFF) as u16;
    let c = (counter & 0xFFFF) as u16 | 0x4000; // Version 4
    let d = ((counter >> 16) & 0x3FFF) as u16 | 0x8000; // Variant
    let e = ((timestamp >> 48) as u64 | (counter << 16)) & 0xFFFFFFFFFFFF;

    format!("{{{:08X}-{:04X}-{:04X}-{:04X}-{:012X}}}", a, b, c, d, e)
}

/// Get current timestamp in ISO 8601 format
pub(super) fn current_timestamp() -> String {
    let ms = standalone_unix_millis();
    let (secs, subsec_millis) = (ms / 1000, (ms % 1000) as u32);

    // Convert to datetime components
    // This is a simplified version - in production use chrono or time crate
    let days_since_epoch = secs / 86400;
    let time_of_day = secs % 86400;

    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;
    let millis = subsec_millis;

    // Calculate year, month, day from days since epoch
    let mut year = 1970;
    let mut remaining_days = days_since_epoch as i64;

    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }

    let days_in_months: [i64; 12] = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 1;
    for &days in &days_in_months {
        if remaining_days < days {
            break;
        }
        remaining_days -= days;
        month += 1;
    }

    let day = remaining_days + 1;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}",
        year, month, day, hours, minutes, seconds, millis
    )
}

fn standalone_unix_millis() -> u64 {
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};

        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0)
    }
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now() as u64
    }
}

fn standalone_unix_nanos() -> u128 {
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};

        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    }
    #[cfg(target_arch = "wasm32")]
    {
        (js_sys::Date::now() * 1_000_000.0) as u128
    }
}

/// Check if a year is a leap year
pub(super) fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

/// Parse a cell reference (e.g., "A1") into (column, row) indices (0-based)
pub(super) fn parse_cell_ref(cell_ref: &str) -> (u32, u32) {
    let mut col: u32 = 0;
    let mut row: u32 = 0;
    let mut in_col = true;

    for c in cell_ref.chars() {
        if in_col {
            if c.is_ascii_alphabetic() {
                col = col * 26 + (c.to_ascii_uppercase() as u32 - 'A' as u32 + 1);
            } else {
                in_col = false;
                if c.is_ascii_digit() {
                    row = c as u32 - '0' as u32;
                }
            }
        } else if c.is_ascii_digit() {
            row = row * 10 + (c as u32 - '0' as u32);
        }
    }

    // Convert to 0-based
    (col.saturating_sub(1), row.saturating_sub(1))
}

/// Convert column and row indices (0-based) to cell reference
#[cfg(test)]
pub(super) fn indices_to_cell_ref(col: u32, row: u32) -> String {
    let mut col_str = String::new();
    let mut c = col;

    loop {
        col_str.insert(0, (b'A' + (c % 26) as u8) as char);
        if c < 26 {
            break;
        }
        c = c / 26 - 1;
    }

    format!("{}{}", col_str, row + 1)
}
