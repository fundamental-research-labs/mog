pub(super) fn empty_patches() -> Vec<u8> {
    compute_wire::mutation::serialize_multi_viewport_patches(&[])
}

pub(super) fn with_empty_patches<T>(result: T) -> (Vec<u8>, T) {
    (empty_patches(), result)
}
