use crate::domain::drawings::write::types::Connection;

use super::common::{minimal_props, roundtrip};

#[test]
fn roundtrip_connection_endpoints() {
    let mut props = minimal_props();
    props.start_connection = Some(Connection {
        shape_id: 5,
        idx: 2,
    });
    props.end_connection = Some(Connection {
        shape_id: 8,
        idx: 0,
    });

    let (orig, rt) = roundtrip(props);

    let orig_st = orig.start_connection.as_ref().unwrap();
    let rt_st = rt.start_connection.as_ref().unwrap();
    assert_eq!(rt_st.shape_id, orig_st.shape_id);
    assert_eq!(rt_st.idx, orig_st.idx);

    let orig_en = orig.end_connection.as_ref().unwrap();
    let rt_en = rt.end_connection.as_ref().unwrap();
    assert_eq!(rt_en.shape_id, orig_en.shape_id);
    assert_eq!(rt_en.idx, orig_en.idx);
}
