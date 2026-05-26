use std::rc::Rc;

#[derive(Clone)]
pub struct AsyncCloneNotSendService {
    value: Rc<()>,
}

impl AsyncCloneNotSendService {
    pub fn new() -> Self {
        Self { value: Rc::new(()) }
    }

    pub async fn get(&self) -> u32 {
        Rc::strong_count(&self.value) as u32
    }
}

#[macro_export]
macro_rules! __bridge_descriptor_AsyncCloneNotSendService_ops {
    ($gen:path) => {
        $gen! {
            bridge_version = 1;
            group = ops;
            service = AsyncCloneNotSendService;
            key_type = str;
            key_param = "service_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method read get {
                params {}
                return_type = u32;
                async;
            }
        }
    };
}

bridge_tauri::generate!(crate::__bridge_descriptor_AsyncCloneNotSendService_ops);

fn assert_send_sync<T: Send + Sync>() {}

fn assert_send_future<F: std::future::Future + Send>(future: F) -> F {
    future
}

fn state<T>() -> tauri::State<'static, T> {
    panic!("compile-only fixture")
}

fn main() {
    assert_send_sync::<AsyncCloneNotSendServiceRegistry>();
    let _future = assert_send_future(async_clone_not_send_service_get(
        state(),
        "service".to_string(),
    ));
}
