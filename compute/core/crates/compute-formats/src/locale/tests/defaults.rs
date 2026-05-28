use super::super::*;

#[test]
fn default_locale_separators() {
    let ci = CultureInfo::default();
    assert_eq!(ci.decimal_separator, ".");
    assert_eq!(ci.thousands_separator, ",");
    assert_eq!(ci.negative_sign, "-");
    assert_eq!(ci.positive_sign, "+");
    assert_eq!(ci.currency_symbol, "$");
    assert_eq!(ci.currency_code, "USD");
    assert_eq!(ci.currency_decimal_digits, 2);
    assert_eq!(ci.percent_symbol, "%");
    assert_eq!(ci.per_mille_symbol, "\u{2030}");
    assert_eq!(ci.short_date_pattern, "M/d/yyyy");
    assert_eq!(ci.long_date_pattern, "dddd, MMMM d, yyyy");
    assert_eq!(ci.short_time_pattern, "h:mm tt");
    assert_eq!(ci.long_time_pattern, "h:mm:ss tt");
    assert_eq!(ci.true_string, "TRUE");
    assert_eq!(ci.false_string, "FALSE");
    assert_eq!(ci.list_separator, ",");
    assert_eq!(ci.first_day_of_week, 0);
    assert_eq!(ci.date_order(), DateOrder::MDY);
    assert!(!ci.use_24_hour());
}

#[test]
fn default_month_names_english() {
    let ci = CultureInfo::default();
    assert_eq!(get_month_name(&ci, 0), "January");
    assert_eq!(get_month_name(&ci, 1), "February");
    assert_eq!(get_month_name(&ci, 2), "March");
    assert_eq!(get_month_name(&ci, 3), "April");
    assert_eq!(get_month_name(&ci, 4), "May");
    assert_eq!(get_month_name(&ci, 5), "June");
    assert_eq!(get_month_name(&ci, 6), "July");
    assert_eq!(get_month_name(&ci, 7), "August");
    assert_eq!(get_month_name(&ci, 8), "September");
    assert_eq!(get_month_name(&ci, 9), "October");
    assert_eq!(get_month_name(&ci, 10), "November");
    assert_eq!(get_month_name(&ci, 11), "December");
}

#[test]
fn default_abbreviated_month_names_english() {
    let ci = CultureInfo::default();
    assert_eq!(get_abbreviated_month_name(&ci, 0), "Jan");
    assert_eq!(get_abbreviated_month_name(&ci, 1), "Feb");
    assert_eq!(get_abbreviated_month_name(&ci, 2), "Mar");
    assert_eq!(get_abbreviated_month_name(&ci, 3), "Apr");
    assert_eq!(get_abbreviated_month_name(&ci, 4), "May");
    assert_eq!(get_abbreviated_month_name(&ci, 5), "Jun");
    assert_eq!(get_abbreviated_month_name(&ci, 6), "Jul");
    assert_eq!(get_abbreviated_month_name(&ci, 7), "Aug");
    assert_eq!(get_abbreviated_month_name(&ci, 8), "Sep");
    assert_eq!(get_abbreviated_month_name(&ci, 9), "Oct");
    assert_eq!(get_abbreviated_month_name(&ci, 10), "Nov");
    assert_eq!(get_abbreviated_month_name(&ci, 11), "Dec");
}

#[test]
fn default_day_names_english() {
    let ci = CultureInfo::default();
    assert_eq!(get_day_name(&ci, 0), "Sunday");
    assert_eq!(get_day_name(&ci, 1), "Monday");
    assert_eq!(get_day_name(&ci, 2), "Tuesday");
    assert_eq!(get_day_name(&ci, 3), "Wednesday");
    assert_eq!(get_day_name(&ci, 4), "Thursday");
    assert_eq!(get_day_name(&ci, 5), "Friday");
    assert_eq!(get_day_name(&ci, 6), "Saturday");
}

#[test]
fn default_abbreviated_day_names_english() {
    let ci = CultureInfo::default();
    assert_eq!(get_abbreviated_day_name(&ci, 0), "Sun");
    assert_eq!(get_abbreviated_day_name(&ci, 1), "Mon");
    assert_eq!(get_abbreviated_day_name(&ci, 2), "Tue");
    assert_eq!(get_abbreviated_day_name(&ci, 3), "Wed");
    assert_eq!(get_abbreviated_day_name(&ci, 4), "Thu");
    assert_eq!(get_abbreviated_day_name(&ci, 5), "Fri");
    assert_eq!(get_abbreviated_day_name(&ci, 6), "Sat");
}
