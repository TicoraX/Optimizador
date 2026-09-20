// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  std::panic::set_hook(Box::new(|info| {
    if let Ok(temp) = std::env::var("TEMP") {
      let path = std::path::PathBuf::from(temp).join("optimizador-tauri-panic.log");
      let _ = std::fs::write(path, format!("{:#?}", info));
    }
  }));
  app_lib::run();
}
