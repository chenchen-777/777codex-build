#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::io::{Read, Write};
use serde_json::{json,Value};
#[cfg(windows)]
fn crypt(value: &str, decrypt: bool) -> Result<String,String> {
    use base64::{engine::general_purpose::STANDARD,Engine};
    use windows_sys::Win32::{Foundation::LocalFree,Security::Cryptography::*};
    let mut bytes=if decrypt {STANDARD.decode(value.strip_prefix("tauri-dpapi-v1:").ok_or("密钥格式不属于 Tauri 版本，请重新同步 Key")?).map_err(|_|"密钥格式无效")?}else{value.as_bytes().to_vec()};
    let input=CRYPT_INTEGER_BLOB{cbData:bytes.len() as u32,pbData:bytes.as_mut_ptr()};
    let mut output=CRYPT_INTEGER_BLOB{cbData:0,pbData:std::ptr::null_mut()};
    let ok=unsafe{if decrypt {CryptUnprotectData(&input,std::ptr::null_mut(),std::ptr::null(),std::ptr::null_mut(),std::ptr::null(),CRYPTPROTECT_UI_FORBIDDEN,&mut output)}else{CryptProtectData(&input,std::ptr::null(),std::ptr::null(),std::ptr::null_mut(),std::ptr::null(),CRYPTPROTECT_UI_FORBIDDEN,&mut output)}};
    bytes.fill(0);
    if ok==0{return Err("Windows 安全存储不可用，拒绝明文保存".into())}
    let mut copied=unsafe{std::slice::from_raw_parts(output.pbData,output.cbData as usize).to_vec()};
    unsafe{std::ptr::write_bytes(output.pbData,0,output.cbData as usize);LocalFree(output.pbData.cast());}
    let result=if decrypt{String::from_utf8(copied.clone()).map_err(|_|"密钥解密失败".to_string())}else{Ok(format!("tauri-dpapi-v1:{}",STANDARD.encode(&copied)))};
    copied.fill(0);result
}
#[cfg(target_os="macos")]
mod macos_vault;
#[cfg(target_os="macos")]
use macos_vault::crypt;
#[cfg(not(any(windows,target_os="macos")))]
fn crypt(_: &str,_:bool)->Result<String,String>{Err("当前系统尚未支持安全存储，不保存密钥".into())}
fn operate(request:&Value)->Result<Value,String>{
    let value=request["value"].as_str().unwrap_or("");
    match request["op"].as_str().unwrap_or("") {
        "protect"=>Ok(json!(crypt(value,false)?)),
        "unprotect"=>Ok(json!(crypt(value,true)?)),
        "chooseDirectory"=>Ok(json!(rfd::FileDialog::new().set_title(if value.trim().is_empty(){"选择目录"}else{value}).pick_folder().map(|p|p.to_string_lossy().to_string()))),
        "chooseZip"=>Ok(json!(rfd::FileDialog::new().set_title("选择官网当前 Windows 公测 ZIP").add_filter("ZIP", &["zip"]).pick_file().map(|p|p.to_string_lossy().to_string()))),
        "openUrl"|"openPath"=>{
            let is_url=request["op"]=="openUrl";
            if is_url {let url=url::Url::parse(value).map_err(|_|"网址无效")?;if !["http","https"].contains(&url.scheme())||url.host_str().is_none()||!url.username().is_empty()||url.password().is_some(){return Err("网址不允许".into())}}
            else if !std::path::Path::new(value).is_absolute()||!std::path::Path::new(value).exists(){return Err("目录不存在".into())}
            #[cfg(windows)] {
                use windows_sys::Win32::{UI::Shell::ShellExecuteW,System::Com::{CoInitializeEx,CoUninitialize,COINIT_APARTMENTTHREADED}};
                if value.contains('\0'){return Err("目标格式无效".into())}
                let target:Vec<u16>=value.encode_utf16().chain(Some(0)).collect();
                let verb:Vec<u16>="open".encode_utf16().chain(Some(0)).collect();
                let initialized=unsafe{CoInitializeEx(std::ptr::null(),COINIT_APARTMENTTHREADED as u32)};
                // Use the current user's association, show the browser normally, and
                // check the shell result instead of treating helper spawn as success.
                let result=unsafe{ShellExecuteW(std::ptr::null_mut(),verb.as_ptr(),target.as_ptr(),std::ptr::null(),std::ptr::null(),1)} as isize;
                if initialized>=0{unsafe{CoUninitialize();}}
                if result<=32{return Err("Windows 未能打开目标，请检查默认浏览器或文件关联后重试".into())}
            }
            #[cfg(target_os="macos")] {
                let status=std::process::Command::new("/usr/bin/open").arg("--").arg(value).status().map_err(|_|"无法打开目标")?;
                if !status.success(){return Err("macOS 未能打开目标，请检查默认浏览器后重试".into())}
            }
            Ok(json!(true))
        }
        _=>Err("不支持的系统操作".into())
    }
}
fn main(){
    let mut raw=String::new();
    let response=match std::io::stdin().take(65537).read_to_string(&mut raw){
        Ok(_) if raw.len()<=65536=>serde_json::from_str(&raw).map_err(|_|"请求格式无效".to_string()).and_then(|r|operate(&r)),
        _=>Err("请求过大或无法读取".into())
    };
    let reply=match response{Ok(value)=>json!({"ok":true,"value":value}),Err(message)=>json!({"ok":false,"message":message})};
    let _=std::io::stdout().write_all(reply.to_string().as_bytes());
}
