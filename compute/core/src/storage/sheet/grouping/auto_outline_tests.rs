use super::super::*;
use super::test_support::*;

#[test]
fn test_auto_outline() {
    let (s, sid) = storage_with_sheet();
    let mut a = MockCellAccessor {
        storage: s,
        cells: {
            let mut m = std::collections::HashMap::new();
            m.insert((0, 0), "10".into());
            m.insert((1, 0), "20".into());
            m.insert((2, 0), "=SUM(A1:A2)".into());
            m
        },
    };
    assert_eq!(auto_outline(&mut a, &sid, &CellRange::new(0, 0, 2, 0)), 1);
    assert_eq!(get_groups(&a.storage, &sid, GroupAxis::Row)[0].start, 0);
}

#[test]
fn test_auto_outline_no_match() {
    let (s, sid) = storage_with_sheet();
    let mut a = MockCellAccessor {
        storage: s,
        cells: {
            let mut m = std::collections::HashMap::new();
            m.insert((0, 0), "10".into());
            m.insert((1, 0), "20".into());
            m.insert((2, 0), "30".into());
            m
        },
    };
    assert_eq!(auto_outline(&mut a, &sid, &CellRange::new(0, 0, 2, 0)), 0);
}
