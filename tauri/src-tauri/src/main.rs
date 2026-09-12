#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{collections::HashMap,io::{BufRead,BufReader,Write},process::{Child,ChildStdin,Command,Stdio},sync::{Arc,Mutex,mpsc,atomic::{AtomicU64,Ordering}},time::Duration};
use tauri::{Manager,WebviewUrl,WebviewWindowBuilder,State};
use serde_json::{json,Value};
type Pending=Arc<Mutex<HashMap<u64,mpsc::Sender<Value>>>>;
#[cfg(windows)]
fn round_native_window(window:&tauri::WebviewWindow)->bool {
    use windows_sys::Win32::{Foundation::RECT,Graphics::Gdi::{CreateRoundRectRgn,DeleteObject,SetWindowRgn},UI::WindowsAndMessaging::GetWindowRect};
    let Ok(hwnd)=window.hwnd() else{return false};
    let mut bounds:RECT=unsafe{std::mem::zeroed()};
    unsafe{
        if GetWindowRect(hwnd.0 as _,&mut bounds)==0{return false;}
        let diameter=(36.0*window.scale_factor().unwrap_or(1.0)).round() as i32;
        let region=CreateRoundRectRgn(0,0,bounds.right-bounds.left+1,bounds.bottom-bounds.top+1,diameter,diameter);
        if region.is_null(){return false;}
        if SetWindowRgn(hwnd.0 as _,region,1)==0{DeleteObject(region);return false;}
        // Windows owns a successfully assigned region. Do not delete it here.
    }
    true
}
struct Backend{child:Mutex<Child>,input:Mutex<ChildStdin>,pending:Pending,next:AtomicU64,url:String,expanded:Mutex<bool>,smoke_report:Option<std::path::PathBuf>}
impl Backend{
    fn request(&self,op:&str)->Result<Value,String>{
        let id=self.next.fetch_add(1,Ordering::Relaxed);let(tx,rx)=mpsc::channel();
        self.pending.lock().map_err(|_|"状态不可用")?.insert(id,tx);
        let write=writeln!(self.input.lock().map_err(|_|"后台不可用")?,"{}",json!({"id":id,"op":op}));
        if write.is_err(){self.pending.lock().unwrap().remove(&id);return Err("后台已退出".into())}
        let reply=rx.recv_timeout(Duration::from_secs(4)).map_err(|_|"后台未响应，未执行关闭".to_string());
        self.pending.lock().unwrap().remove(&id);reply
    }
}
impl Drop for Backend{fn drop(&mut self){if let Ok(child)=self.child.get_mut(){let _=child.kill();let _=child.wait();}}}
#[tauri::command]
fn window_action(window:tauri::WebviewWindow,state:State<'_,Backend>,action:String,details:Option<Value>)->Result<Value,String>{
    if window.label()!="main"||window.url().map_err(|_|"窗口不可用")?.as_str()!=state.url{return Err("窗口来源无效".into())}
    match action.as_str(){
        "corner-check"=>{
            if state.smoke_report.is_none(){return Err("仅用于隔离验收".into());}
            #[cfg(windows)] {
                use windows_sys::Win32::Graphics::Gdi::{CreateRectRgn,GetWindowRgn,PtInRegion,DeleteObject};
                let hwnd=window.hwnd().map_err(|_|"窗口不可用")?;
                let clipped=unsafe{let region=CreateRectRgn(0,0,0,0);if region.is_null(){false}else{let ok=GetWindowRgn(hwnd.0 as _,region)>0&&PtInRegion(region,0,0)==0&&PtInRegion(region,80,80)!=0;DeleteObject(region);ok}};
                return Ok(json!({"nativeCornersClipped":clipped}));
            }
            #[cfg(not(windows))] {Ok(json!({"nativeCornersClipped":false}))}
        },
        "smoke-pass"=>{
            let path=state.smoke_report.as_ref().ok_or("非隔离验收模式")?;
            std::fs::write(path,json!({"ok":true,"framework":"tauri","uiLoaded":true,"platform":std::env::consts::OS,"arch":std::env::consts::ARCH,"details":details}).to_string()).map_err(|_|"无法保存验收结果")?;
            window.app_handle().exit(0);Ok(json!(true))
        },
        "smoke-fail"=>{
            let path=state.smoke_report.as_ref().ok_or("非隔离验收模式")?;
            std::fs::write(path,json!({"ok":false,"framework":"tauri","uiLoaded":true,"error":"UI smoke assertion failed","details":details}).to_string()).map_err(|_|"无法保存验收结果")?;
            window.app_handle().exit(2);Ok(json!(false))
        },
        "minimize"=>{window.minimize().map_err(|_|"无法最小化")?;Ok(json!(true))},
        "drag"=>{window.start_dragging().map_err(|_|"无法拖动")?;Ok(json!(true))},
        "toggle-size"=>{
            let mut expanded=state.expanded.lock().map_err(|_|"窗口状态不可用")?;
            *expanded=!*expanded;
            let monitor=window.current_monitor().map_err(|_|"显示器不可用")?.ok_or("显示器不可用")?;
            let size=monitor.size().to_logical::<f64>(monitor.scale_factor());
            window.set_size(tauri::LogicalSize::new((if *expanded{940.0_f64}else{390.0}).min(size.width),(if *expanded{800.0_f64}else{620.0}).min(size.height-48.0))).map_err(|_|"无法调整窗口")?;
            let _=window.center();Ok(json!({"expanded":*expanded}))
        },
        "close"=>{let reply=state.request("busy")?;if reply["busy"]==false{window.destroy().map_err(|_|"无法关闭")?;}Ok(reply)},
        _=>Err("未知窗口操作".into())
    }
}
fn main(){
    let manager_started_ms=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis().to_string();
    std::panic::set_hook(Box::new(|info|{
        if let Ok(exe)=std::env::current_exe(){if let Some(root)=exe.parent(){let _=std::fs::write(root.join("startup-error.txt"),info.to_string());}}
    }));
    let result=tauri::Builder::default().invoke_handler(tauri::generate_handler![window_action]).setup(move |app|{
        let exe=std::env::current_exe()?;let root=exe.parent().ok_or("程序目录不可用")?;
        let resources=if cfg!(target_os="macos"){app.path().resource_dir()?}else{root.to_path_buf()};
        let backend_root=if cfg!(debug_assertions){std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("backend")}else{resources.join("backend")};
        let runtime_root=backend_root.parent().unwrap().join("runtime");
        // Public portable builds open normally on both systems. Explicit isolation
        // always wins, including when --live was left on an old shortcut.
        let args:Vec<String>=std::env::args().collect();
        let isolated=args.iter().any(|v|v=="--isolated")||std::env::var("MANAGER777_ISOLATED").as_deref()==Ok("1");
        let option_path=|prefix:&str|args.iter().find_map(|v|v.strip_prefix(prefix)).map(std::path::PathBuf::from).filter(|p|p.is_absolute());
        let smoke_report=if isolated{option_path("--smoke-report=").or_else(||std::env::var_os("MANAGER777_SMOKE_REPORT").map(std::path::PathBuf::from).filter(|p|p.is_absolute()))}else{None};
        let isolated_state=if isolated{option_path("--state-root=").or_else(||std::env::var_os("MANAGER777_STATE_ROOT").map(std::path::PathBuf::from).filter(|p|p.is_absolute()))}else{None};
        let native=if cfg!(windows){root.join("helpers/777-native.exe")}else{root.join("777-native")};
        let node=runtime_root.join(if cfg!(windows){"node.exe"}else{"node"});
        if !node.is_file()||!native.is_file(){return Err("程序组件不完整，请完整解压便携压缩包".into())}
        let mut command=Command::new(node);
        command.arg(backend_root.join("scripts/sidecar.mjs")).current_dir(&backend_root).env("MANAGER777_NATIVE",native)
            .env("MANAGER777_INSTALL_ROOT",if cfg!(target_os="macos"){root.parent().and_then(|p|p.parent()).unwrap_or(root)}else{root})
            .env("MANAGER777_EXECUTABLE",&exe).env("MANAGER777_OUTER_PID",std::process::id().to_string()).env("MANAGER777_OUTER_START_EPOCH_MS",&manager_started_ms)
            .env("MANAGER777_ISOLATED",if isolated{"1"}else{"0"})
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        if let Some(path)=isolated_state.as_ref(){command.env("MANAGER777_STATE_ROOT",path);}
        if cfg!(windows){command.env("MANAGER777_CODEXPP",root.join("helpers/777-codexpp.exe"));}
        #[cfg(windows)] {use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
        let mut child=command.spawn()?;let input=child.stdin.take().unwrap();let output=child.stdout.take().unwrap();
        let pending:Pending=Arc::new(Mutex::new(HashMap::new()));let replies=pending.clone();let(tx,rx)=mpsc::channel();
        std::thread::spawn(move||{
            for line in BufReader::new(output).lines().map_while(Result::ok){
                if line.len()>65536{continue}
                if let Ok(message)=serde_json::from_str::<Value>(&line){
                    if message["kind"]=="ready"{let _=tx.send(message);}
                    else if let Some(id)=message["id"].as_u64(){if let Some(reply)=replies.lock().unwrap().remove(&id){let _=reply.send(message);}}
                }
            }
        });
        let ready=match rx.recv_timeout(Duration::from_secs(25)){Ok(v)=>v,Err(_)=>{let _=child.kill();let _=child.wait();return Err("后台启动超时，请检查组件是否完整".into())}};
        let url=format!("{}/",ready["url"].as_str().ok_or("后台地址无效")?);
        let parsed=url::Url::parse(&url)?;
        if parsed.scheme()!="http"||parsed.host_str()!=Some("127.0.0.1")||parsed.port().is_none(){let _=child.kill();return Err("后台地址不安全".into())}
        let smoke=smoke_report.is_some();
        app.manage(Backend{child:Mutex::new(child),input:Mutex::new(input),pending,next:AtomicU64::new(1),url:url.clone(),expanded:Mutex::new(false),smoke_report});
        let allowed=url.clone();
        let window_data=if cfg!(target_os="macos"){
            let base=if isolated{isolated_state.clone().unwrap_or(app.path().app_cache_dir()?.join("isolated"))}else{app.path().app_data_dir()?};
            base.join("Window")
        }else if isolated{isolated_state.clone().unwrap_or(backend_root.join(".window-data")).join("Window")}else{backend_root.join(".window-data")};
        let window=WebviewWindowBuilder::new(app,"main",WebviewUrl::External(parsed))
            .title("GCC CodeX 管理工具").inner_size(if smoke{360.0}else{390.0},620.0).min_inner_size(360.0,520.0)
            .decorations(false).transparent(true).shadow(false).resizable(true).center()
            .background_color(tauri::window::Color(0,0,0,0))
            .data_directory(window_data)
            .on_page_load(move|window,payload|{
                if smoke && payload.event()==tauri::webview::PageLoadEvent::Finished {
                    let script=include_str!("../../ui/demo-webview-smoke.js");
                    let _=window.eval(script);
                }
            })
            .on_navigation(move|target|target.as_str()==allowed).build()?;
        let handle=app.handle().clone();
        #[cfg(windows)] {round_native_window(&window);}
        window.on_window_event(move|event|{
            #[cfg(windows)]
            if matches!(event,tauri::WindowEvent::Resized(_)|tauri::WindowEvent::ScaleFactorChanged{..}){
                if let Some(window)=handle.get_webview_window("main"){round_native_window(&window);}
            }
            if let tauri::WindowEvent::CloseRequested{api,..}=event{
                // Fail closed: never interrupt an installer when the backend is busy/unreachable.
                match handle.state::<Backend>().request("busy"){
                    Ok(reply) if reply["busy"]==false=>{},
                    _=>{api.prevent_close();let _=rfd::MessageDialog::new().set_title("暂时不能关闭").set_description("正在执行操作或后台未响应，请等待完成后再关闭。").show();}
                }
            }
        });
        Ok(())
    }).build(tauri::generate_context!());
    match result{Ok(app)=>app.run(|handle,event|{if let tauri::RunEvent::Exit=event{if let Some(state)=handle.try_state::<Backend>(){if let Ok(mut child)=state.child.lock(){let _=child.kill();let _=child.wait();}}}}),Err(_)=>{rfd::MessageDialog::new().set_title("GCC CodeX 管理工具 启动失败").set_description(if cfg!(target_os="macos"){ "管理工具无法启动，请将完整应用移到 Applications 后重试。原版配置未修改。" }else{ "管理工具无法启动。请检查 WebView2 及便携包是否完整；原版配置未修改。" }).show();}}
}
