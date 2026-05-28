use super::super::*;

#[test]
fn custom_month_names() {
    let ci = CultureInfo {
        month_names: [
            "Enero".to_string(),
            "Febrero".to_string(),
            "Marzo".to_string(),
            "Abril".to_string(),
            "Mayo".to_string(),
            "Junio".to_string(),
            "Julio".to_string(),
            "Agosto".to_string(),
            "Septiembre".to_string(),
            "Octubre".to_string(),
            "Noviembre".to_string(),
            "Diciembre".to_string(),
        ],
        ..Default::default()
    };
    assert_eq!(get_month_name(&ci, 0), "Enero");
    assert_eq!(get_month_name(&ci, 8), "Septiembre");
    assert_eq!(get_month_name(&ci, 11), "Diciembre");
}

#[test]
fn month_first_letter() {
    let ci = CultureInfo::default();
    assert_eq!(get_month_first_letter(&ci, 0), "J");
    assert_eq!(get_month_first_letter(&ci, 1), "F");
    assert_eq!(get_month_first_letter(&ci, 4), "M");
    assert_eq!(get_month_first_letter(&ci, 7), "A");
    assert_eq!(get_month_first_letter(&ci, 11), "D");
}

#[test]
fn month_first_letter_unicode() {
    let ci = CultureInfo {
        month_names: [
            "\u{00D6}cak".to_string(),
            "Feb".to_string(),
            "Mar".to_string(),
            "Apr".to_string(),
            "May".to_string(),
            "Jun".to_string(),
            "Jul".to_string(),
            "Aug".to_string(),
            "Sep".to_string(),
            "Oct".to_string(),
            "Nov".to_string(),
            "Dec".to_string(),
        ],
        ..Default::default()
    };
    assert_eq!(get_month_first_letter(&ci, 0), "\u{00D6}");
}

#[test]
fn custom_day_names() {
    let ci = CultureInfo {
        day_names: [
            "Dimanche".to_string(),
            "Lundi".to_string(),
            "Mardi".to_string(),
            "Mercredi".to_string(),
            "Jeudi".to_string(),
            "Vendredi".to_string(),
            "Samedi".to_string(),
        ],
        ..Default::default()
    };
    assert_eq!(get_day_name(&ci, 0), "Dimanche");
    assert_eq!(get_day_name(&ci, 3), "Mercredi");
    assert_eq!(get_day_name(&ci, 6), "Samedi");
}

#[test]
fn am_pm_designator_default() {
    let ci = CultureInfo::default();
    assert_eq!(get_am_pm_designator(&ci, 0), "AM");
    assert_eq!(get_am_pm_designator(&ci, 6), "AM");
    assert_eq!(get_am_pm_designator(&ci, 11), "AM");
    assert_eq!(get_am_pm_designator(&ci, 12), "PM");
    assert_eq!(get_am_pm_designator(&ci, 18), "PM");
    assert_eq!(get_am_pm_designator(&ci, 23), "PM");
    assert_eq!(get_am_pm_designator(&ci, 24), "PM");
}

#[test]
fn am_pm_designator_custom() {
    let ci = CultureInfo {
        am_designator: "\u{5348}\u{524d}".to_string(),
        pm_designator: "\u{5348}\u{5f8c}".to_string(),
        ..Default::default()
    };
    assert_eq!(get_am_pm_designator(&ci, 5), "\u{5348}\u{524d}");
    assert_eq!(get_am_pm_designator(&ci, 15), "\u{5348}\u{5f8c}");
}

#[test]
fn month_index_wraps() {
    let ci = CultureInfo::default();
    assert_eq!(get_month_name(&ci, 12), "January");
    assert_eq!(get_month_name(&ci, 13), "February");
}

#[test]
fn day_index_wraps() {
    let ci = CultureInfo::default();
    assert_eq!(get_day_name(&ci, 7), "Sunday");
    assert_eq!(get_day_name(&ci, 8), "Monday");
}
