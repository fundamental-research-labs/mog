use super::*;

#[test]
fn test_position_in_range_inside() {
    let rr = IdentityRangeSchemaRef {
        start_id: "0:0".to_string(),
        end_id: "10:5".to_string(),
        sheet_id: None,
    };
    assert!(position_in_range(0, 0, &rr));
    assert!(position_in_range(5, 3, &rr));
    assert!(position_in_range(10, 5, &rr));
}
#[test]
fn test_position_in_range_outside() {
    let rr = IdentityRangeSchemaRef {
        start_id: "2:2".to_string(),
        end_id: "5:5".to_string(),
        sheet_id: None,
    };
    assert!(!position_in_range(0, 0, &rr));
    assert!(!position_in_range(1, 3, &rr));
    assert!(!position_in_range(6, 3, &rr));
    assert!(!position_in_range(3, 6, &rr));
}
#[test]
fn test_position_in_range_reversed_start_end() {
    let rr = IdentityRangeSchemaRef {
        start_id: "10:5".to_string(),
        end_id: "0:0".to_string(),
        sheet_id: None,
    };
    assert!(position_in_range(5, 3, &rr));
}
#[test]
fn test_position_in_range_unparseable() {
    let rr = IdentityRangeSchemaRef {
        start_id: "abc".to_string(),
        end_id: "def".to_string(),
        sheet_id: None,
    };
    assert!(!position_in_range(0, 0, &rr));
}
