use std::sync::{Mutex, MutexGuard};

static LOCK: Mutex<()> = Mutex::new(());

pub struct NotSendService {
    _guard: MutexGuard<'static, ()>,
}

impl NotSendService {
    pub fn new() -> Self {
        Self {
            _guard: LOCK.lock().unwrap(),
        }
    }

    pub fn get(&self) -> u32 {
        7
    }
}

#[macro_export]
macro_rules! __bridge_descriptor_NotSendService_ops {
    ($gen:path) => {
        $gen! {
            bridge_version = 1;
            group = ops;
            service = NotSendService;
            key_type = str;
            key_param = "service_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method read get {
                params {}
                return_type = u32;
            }
        }
    };
}

bridge_tauri::generate!(crate::__bridge_descriptor_NotSendService_ops);

fn assert_send_sync<T: Send + Sync>() {}

fn main() {
    assert_send_sync::<NotSendServiceRegistry>();
}
