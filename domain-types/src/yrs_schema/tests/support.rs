use yrs::{Any, Doc, Map, MapPrelim, Transact};

pub fn roundtrip_map<T>(
    entries: Vec<(&str, Any)>,
    from_fn: impl for<'a> FnOnce(&yrs::MapRef, &yrs::Transaction<'a>) -> Option<T>,
) -> T {
    let doc = Doc::new();
    let root = doc.get_or_insert_map("test");
    {
        let mut txn = doc.transact_mut();
        let prelim: MapPrelim = entries.into_iter().collect();
        root.insert(&mut txn, "item", prelim);
    }

    let txn = doc.transact();
    let map_ref = root
        .get(&txn, "item")
        .expect("roundtrip map child should exist")
        .cast::<yrs::MapRef>()
        .expect("roundtrip child should be a Y.Map");
    from_fn(&map_ref, &txn).expect("adapter should hydrate from Y.Map")
}

pub fn roundtrip_map_value<T>(
    entries: Vec<(&str, Any)>,
    from_fn: impl for<'a> FnOnce(&yrs::MapRef, &yrs::Transaction<'a>) -> T,
) -> T {
    let doc = Doc::new();
    let root = doc.get_or_insert_map("test");
    {
        let mut txn = doc.transact_mut();
        let prelim: MapPrelim = entries.into_iter().collect();
        root.insert(&mut txn, "item", prelim);
    }

    let txn = doc.transact();
    let map_ref = root
        .get(&txn, "item")
        .expect("roundtrip map child should exist")
        .cast::<yrs::MapRef>()
        .expect("roundtrip child should be a Y.Map");
    from_fn(&map_ref, &txn)
}

pub fn roundtrip_string_map_value<T>(
    entries: Vec<(String, Any)>,
    from_fn: impl for<'a> FnOnce(&yrs::MapRef, &yrs::Transaction<'a>) -> T,
) -> T {
    let doc = Doc::new();
    let root = doc.get_or_insert_map("test");
    {
        let mut txn = doc.transact_mut();
        let prelim: MapPrelim = entries.into_iter().collect();
        root.insert(&mut txn, "item", prelim);
    }

    let txn = doc.transact();
    let map_ref = root
        .get(&txn, "item")
        .expect("roundtrip map child should exist")
        .cast::<yrs::MapRef>()
        .expect("roundtrip child should be a Y.Map");
    from_fn(&map_ref, &txn)
}
