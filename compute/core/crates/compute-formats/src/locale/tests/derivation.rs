use super::super::*;

#[test]
fn date_order_derived_from_pattern() {
    assert_eq!(get_culture("en-US").date_order(), DateOrder::MDY);
    assert_eq!(get_culture("de-DE").date_order(), DateOrder::DMY);
    assert_eq!(get_culture("ja-JP").date_order(), DateOrder::YMD);
    assert_eq!(get_culture("ko-KR").date_order(), DateOrder::YMD);
    assert_eq!(get_culture("es-ES").date_order(), DateOrder::DMY);

    assert_eq!(
        CultureInfo {
            short_date_pattern: "time only".to_string(),
            ..Default::default()
        }
        .date_order(),
        DateOrder::MDY
    );
    assert_eq!(
        CultureInfo {
            short_date_pattern: "yyyy later M/d".to_string(),
            ..Default::default()
        }
        .date_order(),
        DateOrder::YMD
    );
}

#[test]
fn use_24_hour_derived_from_pattern() {
    assert!(!get_culture("en-US").use_24_hour());
    assert!(get_culture("de-DE").use_24_hour());
    assert!(get_culture("fr-FR").use_24_hour());
    assert!(get_culture("ja-JP").use_24_hour());
    assert!(!get_culture("ko-KR").use_24_hour());

    assert!(
        !CultureInfo {
            short_time_pattern: "HH:mm literal t".to_string(),
            ..Default::default()
        }
        .use_24_hour()
    );
    assert!(
        CultureInfo {
            short_time_pattern: "HH:mm T".to_string(),
            ..Default::default()
        }
        .use_24_hour()
    );
}
