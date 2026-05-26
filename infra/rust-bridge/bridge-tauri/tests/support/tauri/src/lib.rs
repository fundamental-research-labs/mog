pub use tauri_macros::command;

pub mod ipc {
    pub struct Response {
        bytes: Vec<u8>,
    }

    impl Response {
        pub fn new(bytes: Vec<u8>) -> Self {
            Self { bytes }
        }

        pub fn into_bytes(self) -> Vec<u8> {
            self.bytes
        }
    }
}

pub struct State<'a, T: ?Sized>(&'a T);

impl<'a, T: ?Sized> State<'a, T> {
    pub fn new(value: &'a T) -> Self {
        Self(value)
    }
}

impl<T: ?Sized> std::ops::Deref for State<'_, T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        self.0
    }
}

pub struct Window;

pub struct AppHandle;
