#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// Only launches the bundled application; no shell, elevation, downloads or security changes.
fn main() {
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let exe = std::env::current_exe()?;
        let root = exe.parent().ok_or("missing application directory")?;
        let app = root.join("app/777Codex.exe");
        if !app.is_file() { return Err("incomplete package".into()); }
        std::process::Command::new(&app).current_dir(root.join("app"))
            .args(std::env::args_os().skip(1)).spawn()?;
        Ok(())
    })();
    if result.is_err() {
        rfd::MessageDialog::new().set_title("安装包未完整解压")
            .set_description("请完整解压分享安装包，再双击 777Codex.exe。不要单独移动启动程序或 app 文件夹。")
            .show();
    }
}
