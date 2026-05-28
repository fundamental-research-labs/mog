use super::*;

#[test]
fn sqref_list_parse_and_back() {
    let list = SqrefList::parse("A1 B2:C3").unwrap();
    assert_eq!(list.len(), 2);
    let s = list.to_a1_string();
    let list2 = SqrefList::parse(&s).unwrap();
    assert_eq!(list, list2);
}

#[test]
fn sqref_list_emits_single_cell_without_redundant_tail() {
    let list = SqrefList::parse("A1").unwrap();
    assert_eq!(list.to_a1_string(), "A1");

    let list_expanded = SqrefList::parse("A1:A1").unwrap();
    assert_eq!(list, list_expanded);
    assert_eq!(list_expanded.to_a1_string(), "A1");

    let list = SqrefList::parse("A1 B2:C3").unwrap();
    assert_eq!(list.to_a1_string(), "A1 B2:C3");

    let list = SqrefList::parse("$B$5").unwrap();
    assert_eq!(list.to_a1_string(), "B5");
}

#[test]
fn sqref_list_parse_rejects_empty() {
    assert!(SqrefList::parse("").is_none());
    assert!(SqrefList::parse("   ").is_none());
}
