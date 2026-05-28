use super::super::FormatCache;
use super::make_input;

#[test]
fn format_cache_deduplication() {
    let input = make_input();
    let mut cache = FormatCache::new();

    let fmt1 = cache.get(1, &input).cloned();
    let fmt2 = cache.get(1, &input).cloned();
    assert_eq!(fmt1, fmt2);
    assert!(fmt1.is_some());
}
