use super::super::normalize_rgb_color;

#[test]
fn test_normalize_rgb_color() {
    assert_eq!(normalize_rgb_color("#FF0000"), "#FF0000");
    assert_eq!(normalize_rgb_color("FF0000"), "#FF0000");
    assert_eq!(normalize_rgb_color("FFFF0000"), "#FF0000"); // ARGB
}
