use std::path::PathBuf;
use std::process::Child;
use std::sync::{Arc, Mutex};

#[cfg(windows)]
mod job_object {
    use std::mem::size_of;
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    pub struct JobObject(HANDLE);

    unsafe impl Send for JobObject {}
    unsafe impl Sync for JobObject {}

    impl JobObject {
        pub fn new() -> Result<Self, String> {
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    return Err("No se pudo crear el Windows Job Object".into());
                }

                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

                let res = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );

                if res == 0 {
                    CloseHandle(job);
                    return Err("No se pudo configurar JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE".into());
                }

                Ok(Self(job))
            }
        }

        pub fn assign_process(&self, child: &Child) -> Result<(), String> {
            unsafe {
                let handle = child.as_raw_handle() as HANDLE;
                let res = AssignProcessToJobObject(self.0, handle);
                if res == 0 {
                    return Err("No se pudo asociar el proceso hijo al Job Object".into());
                }
                Ok(())
            }
        }
    }

    impl Drop for JobObject {
        fn drop(&mut self) {
            unsafe {
                if !self.0.is_null() {
                    CloseHandle(self.0);
                }
            }
        }
    }
}

pub struct ServerState {
    #[cfg(windows)]
    _job: Option<job_object::JobObject>,
    child: Mutex<Option<Child>>,
}

impl ServerState {
    pub fn new() -> Self {
        Self {
            #[cfg(windows)]
            _job: None,
            child: Mutex::new(None),
        }
    }

    pub fn terminate(&self) {
        if let Ok(mut lock) = self.child.lock() {
            if let Some(mut child) = lock.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn resolve_server_script() -> PathBuf {
    let direct = PathBuf::from("server/server.js");
    if direct.exists() {
        return direct;
    }
    let parent = PathBuf::from("../server/server.js");
    if parent.exists() {
        return parent;
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let from_exe = dir.join("server/server.js");
            if from_exe.exists() {
                return from_exe;
            }
            let from_exe_parent = dir.join("../server/server.js");
            if from_exe_parent.exists() {
                return from_exe_parent;
            }
            let resources = dir.join("resources/server/server.js");
            if resources.exists() {
                return resources;
            }
        }
    }
    direct
}

fn spawn_server() -> Result<ServerState, String> {
    let script_path = resolve_server_script();
    let working_dir = script_path
        .canonicalize()
        .ok()
        .and_then(|p| p.parent().and_then(|s| s.parent().map(|r| r.to_path_buf())))
        .unwrap_or_else(|| PathBuf::from("."));

    let mut cmd = std::process::Command::new("node");
    cmd.arg(&script_path);
    cmd.current_dir(&working_dir);
    cmd.env("PORT", "3001");
    cmd.env("NODE_ENV", "production");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Error al iniciar el subproceso Node (server.js): {}", e))?;

    #[cfg(windows)]
    {
        let job = job_object::JobObject::new()?;
        job.assign_process(&child)?;
        Ok(ServerState {
            _job: Some(job),
            child: Mutex::new(Some(child)),
        })
    }

    #[cfg(not(windows))]
    {
        Ok(ServerState {
            child: Mutex::new(Some(child)),
        })
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let server_state = match spawn_server() {
        Ok(state) => Arc::new(state),
        Err(err) => {
            eprintln!("[error] {}", err);
            Arc::new(ServerState::new())
        }
    };

    let server_for_events = Arc::clone(&server_state);

    let app = tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .manage(server_state)
        .build(tauri::generate_context!())
        .expect("Error al inicializar la aplicación Tauri");

    app.run(move |_app_handle, event| {
        match event {
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                server_for_events.terminate();
            }
            _ => {}
        }
    });
}
