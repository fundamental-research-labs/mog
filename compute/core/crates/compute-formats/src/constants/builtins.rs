/// Excel built-in format IDs (numFmtId 0-49).
/// Maps the numeric format ID used in XLSX files to the format code string.
pub static EXCEL_BUILTIN_FORMATS: &[(u32, &str)] = &[
    (0, "General"),
    (1, "0"),
    (2, "0.00"),
    (3, "#,##0"),
    (4, "#,##0.00"),
    (9, "0%"),
    (10, "0.00%"),
    (11, "0.00E+00"),
    (12, "# ?/?"),
    (13, "# ??/??"),
    (14, "m/d/yy"),
    (15, "d-mmm-yy"),
    (16, "d-mmm"),
    (17, "mmm-yy"),
    (18, "h:mm AM/PM"),
    (19, "h:mm:ss AM/PM"),
    (20, "h:mm"),
    (21, "h:mm:ss"),
    (22, "m/d/yy h:mm"),
    (37, "#,##0 ;(#,##0)"),
    (38, "#,##0 ;[Red](#,##0)"),
    (39, "#,##0.00;(#,##0.00)"),
    (40, "#,##0.00;[Red](#,##0.00)"),
    (45, "mm:ss"),
    (46, "[h]:mm:ss"),
    (47, "mm:ss.0"),
    (48, "##0.0E+0"),
    (49, "@"),
];

/// Look up a built-in format code by its `numFmtId`.
///
/// Returns `None` if the ID is not one of the standard Excel built-in format IDs
/// (0-49, with gaps).
///
/// # Examples
///
/// ```
/// use compute_formats::builtin_format;
///
/// assert_eq!(builtin_format(0), Some("General"));
/// assert_eq!(builtin_format(14), Some("m/d/yy"));
/// assert_eq!(builtin_format(49), Some("@"));
/// assert_eq!(builtin_format(5), None); // not a standard builtin
/// ```
#[must_use]
pub fn builtin_format(id: u32) -> Option<&'static str> {
    EXCEL_BUILTIN_FORMATS
        .iter()
        .find(|(k, _)| *k == id)
        .map(|(_, v)| *v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_formats_has_28_entries() {
        assert_eq!(EXCEL_BUILTIN_FORMATS.len(), 28);
    }

    #[test]
    fn builtin_format_general() {
        assert_eq!(builtin_format(0), Some("General"));
    }

    #[test]
    fn builtin_format_number_formats() {
        assert_eq!(builtin_format(1), Some("0"));
        assert_eq!(builtin_format(2), Some("0.00"));
        assert_eq!(builtin_format(3), Some("#,##0"));
        assert_eq!(builtin_format(4), Some("#,##0.00"));
    }

    #[test]
    fn builtin_format_percent_formats() {
        assert_eq!(builtin_format(9), Some("0%"));
        assert_eq!(builtin_format(10), Some("0.00%"));
    }

    #[test]
    fn builtin_format_scientific() {
        assert_eq!(builtin_format(11), Some("0.00E+00"));
    }

    #[test]
    fn builtin_format_fraction() {
        assert_eq!(builtin_format(12), Some("# ?/?"));
        assert_eq!(builtin_format(13), Some("# ??/??"));
    }

    #[test]
    fn builtin_format_date_time_formats() {
        assert_eq!(builtin_format(14), Some("m/d/yy"));
        assert_eq!(builtin_format(18), Some("h:mm AM/PM"));
        assert_eq!(builtin_format(19), Some("h:mm:ss AM/PM"));
        assert_eq!(builtin_format(20), Some("h:mm"));
        assert_eq!(builtin_format(21), Some("h:mm:ss"));
        assert_eq!(builtin_format(45), Some("mm:ss"));
        assert_eq!(builtin_format(46), Some("[h]:mm:ss"));
        assert_eq!(builtin_format(47), Some("mm:ss.0"));
    }

    #[test]
    fn builtin_format_text() {
        assert_eq!(builtin_format(49), Some("@"));
    }

    #[test]
    fn builtin_format_accounting_formats() {
        assert_eq!(builtin_format(37), Some("#,##0 ;(#,##0)"));
        assert_eq!(builtin_format(38), Some("#,##0 ;[Red](#,##0)"));
        assert_eq!(builtin_format(39), Some("#,##0.00;(#,##0.00)"));
        assert_eq!(builtin_format(40), Some("#,##0.00;[Red](#,##0.00)"));
    }

    #[test]
    fn builtin_format_unknown_ids_return_none() {
        assert_eq!(builtin_format(5), None);
        assert_eq!(builtin_format(50), None);
        assert_eq!(builtin_format(100), None);
        assert_eq!(builtin_format(999), None);
    }
}
