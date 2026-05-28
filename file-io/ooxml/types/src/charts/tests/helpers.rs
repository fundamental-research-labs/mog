macro_rules! assert_roundtrip {
    ($ty:ty, [$($variant:expr),+ $(,)?]) => {
        $(
            {
                let v: $ty = $variant;
                let serialized = v.to_ooxml();
                let deserialized = <$ty>::from_ooxml(serialized);
                assert_eq!(v, deserialized, "roundtrip failed for {:?}", v);
            }
        )+
    };
}
