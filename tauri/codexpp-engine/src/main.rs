// AGPL-3.0-only. Integrates chenchen-777/CodexPlusPlus v1.2.56-777.4.
// Deliberately does not run upstream launcher_main: provider rewriting,
// SQLite sanitization, external watcher installation and auto-update are not
// part of starting enhancements in the GCC manager.
use anyhow::{Result, ensure};
use codex_plus_core::{assets, bridge, cdp, plugin_marketplace, routes, settings::{BackendSettings, SettingsStore}, status::StatusStore};
use codex_plus_core::launcher::{DefaultLaunchHooks, LaunchHooks};
use codex_plus_core::models::{DeleteResult, ExportResult, SessionRef};
use codex_plus_core::routes::{BridgeDataService, BridgeSettingsService};
use serde_json::{Value, json};
use std::{path::{Path, PathBuf}, sync::Arc};
use tokio::io::{AsyncBufReadExt, BufReader};

const VERSION: &str = "1.2.56-777.4";
const FLAGS: &[&str] = &[
 "codexAppPluginMarketplaceUnlock", "codexAppModelWhitelistUnlock", "codexAppSessionDelete",
 "codexAppMarkdownExport", "codexAppPasteFix", "codexAppFastStartup", "codexAppThreadIdBadge",
 "codexAppConversationView", "codexAppThreadScrollRestore", "codexAppZedRemoteOpen",
 "codexAppUpstreamWorktreeCreate", "codexAppNativeMenuPlacement", "codexAppServiceTierControls",
 "codexAppAnswerOutlineEnabled", "codexAppPetRealMouseLook",
];
fn output(value: Value) { println!("{}", value); }
fn absolute(v: &Value, key: &str) -> Result<PathBuf> {
 let p=PathBuf::from(v[key].as_str().unwrap_or_default());
 ensure!(p.is_absolute(), "invalid scoped path"); Ok(p)
}
fn safe_settings(value: &Value) -> Result<BackendSettings> {
 ensure!(value.is_object(), "settings must be an object");
 for (key, v) in value.as_object().unwrap() { ensure!(FLAGS.contains(&key.as_str()) && v.is_boolean(), "unsupported enhancement setting"); }
 let mut raw=serde_json::to_value(BackendSettings::default())?;
 for key in FLAGS { raw[*key]=json!(false); }
 for (key,v) in value.as_object().unwrap() {raw[key]=v.clone();}
 raw["relayProfilesEnabled"]=json!(false);
 raw["providerSyncEnabled"]=json!(false);
 raw["zedRemoteProjectRegistryEnabled"]=json!(false);
 raw["codexAppForceChineseLocale"]=json!(false);
 raw["codexAppNativeMenuLocalization"]=json!(false);
 raw["enhancementsEnabled"]=json!(true);
 Ok(serde_json::from_value(raw)?)
}
struct LocalSettings { store: SettingsStore }
#[async_trait::async_trait]
impl BridgeSettingsService for LocalSettings {
 async fn get_settings(&self)->Result<BackendSettings>{ self.store.load() }
 async fn set_settings(&self, payload:Value)->Result<BackendSettings>{
  let mut current=serde_json::to_value(self.store.load()?)?;
  for (key,value) in payload.as_object().ok_or_else(||anyhow::anyhow!("invalid settings"))? {
   ensure!(FLAGS.contains(&key.as_str())&&value.is_boolean(),"change this setting in GCC manager");current[key]=value.clone();
  }
  let next:BackendSettings=serde_json::from_value(current)?;self.store.save(&next)?;Ok(next)
 }
}
struct LocalData { home:PathBuf, backups:PathBuf }
impl LocalData {
 fn databases(&self)->Vec<PathBuf>{
  std::fs::read_dir(&self.home).into_iter().flatten().filter_map(|e|e.ok()).filter(|e|e.file_type().map(|t|t.is_file()).unwrap_or(false))
   .filter(|e|{let n=e.file_name().to_string_lossy().to_string();n.starts_with("state_")&&n.ends_with(".sqlite")}).map(|e|e.path()).collect()
 }
 fn adapter(&self)->codex_plus_data::SQLiteStorageAdapter{
  let paths=self.databases();codex_plus_data::SQLiteStorageAdapter::new(paths.first().cloned().unwrap_or(self.home.join("state_5.sqlite")),codex_plus_data::BackupStore::new(self.backups.clone())).with_allowed_db_paths(paths).with_codex_home(self.home.clone())
 }
}
#[async_trait::async_trait]
impl BridgeDataService for LocalData {
 async fn delete(&self,s:SessionRef)->Result<DeleteResult>{
  // Upstream's API-only fallback edits the JSONL index without issuing an undo token.
  // Preserve that index separately before allowing either deletion path.
  let index=self.home.join("session_index.jsonl");
  if index.exists(){ensure!(!std::fs::symlink_metadata(&index)?.file_type().is_symlink(),"linked session index rejected");std::fs::create_dir_all(&self.backups)?;
   let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_nanos();
   std::fs::copy(&index,self.backups.join(format!("index-before-{stamp}.jsonl")))?;
  }
  Ok(codex_plus_data::delete_local_from_paths(self.databases(),codex_plus_data::BackupStore::new(self.backups.clone()),&s,Some(&self.home)))
 }
 async fn undo(&self,token:String)->Result<DeleteResult>{Ok(self.adapter().undo(&token))}
 async fn export_markdown(&self,s:SessionRef)->Result<ExportResult>{Ok(codex_plus_data::export_markdown_from_paths(self.databases(),&s))}
 async fn thread_usage_history(&self,s:SessionRef)->Result<Value>{Ok(self.adapter().codex_thread_usage_history(&s))}
 async fn find_archived_thread_by_title(&self,title:String)->Result<Option<SessionRef>>{Ok(self.adapter().find_archived_thread_by_title(&title))}
}
async fn inject(port:u16,root:&Path,home:&Path,settings:BackendSettings)->Result<()> {
 let target=cdp::pick_injectable_codex_page_target(&cdp::list_targets(port).await?)?;
 let ws=target.web_socket_debugger_url.ok_or_else(||anyhow::anyhow!("no Codex page"))?;
 cdp::validate_cdp_websocket_url(&ws,port)?;
 let runtime=routes::CoreRuntimeService::new(port,StatusStore::new(root.join("runtime-status.json"))).with_websocket_url(ws.clone());
 let ctx=routes::BridgeContext::new(Arc::new(LocalSettings{store:SettingsStore::new(root.join("runtime-settings.json"))}),Arc::new(runtime),Arc::new(LocalData{home:home.to_path_buf(),backups:root.join("session-backups")}));
 bridge::install_bridge(&ws,bridge::BRIDGE_BINDING_NAME,Arc::new(move|path,payload|{
  let ctx=ctx.clone();Box::pin(async move {
   // No marketing, external sharing or second manager is launched implicitly.
   if path=="/ads" {return Ok(json!({"status":"ok","ads":[]}));}
   if path.starts_with("/manager/")||path.contains("share")||path.contains("user-scripts")||path=="/llm-proxy"||path.starts_with("/stepwise/")||path.starts_with("/session/")||path.starts_with("/remote-control-session/") {return Ok(json!({"status":"failed","message":"请在 GCC 管理工具中管理此功能"}));}
   Ok(routes::handle_bridge_request(ctx,&path,payload).await)
  })
 }),&[assets::injection_script_with_settings(0,&settings)]).await
}
async fn execute(v:Value)->Result<()> {
 let action=v["action"].as_str().unwrap_or_default();
 if action=="version" {output(json!({"ok":true,"version":VERSION,"flags":FLAGS}));return Ok(());}
 let home=absolute(&v,"codexRoot")?;
 match action {
  "status"=>{let s=plugin_marketplace::openai_curated_remote_marketplace_status(&home);output(json!({"ok":true,"version":VERSION,"registered":s.config_registered,"needsRepair":s.needs_repair(),"path":s.marketplace_root}));},
  "repair"=>{plugin_marketplace::ensure_openai_curated_remote_marketplace_available(&home)?;let s=plugin_marketplace::openai_curated_remote_marketplace_status(&home);ensure!(!s.needs_repair(),"marketplace registration not verified");output(json!({"ok":true,"registered":true,"path":s.marketplace_root}));},
  "register"=>{plugin_marketplace::ensure_openai_curated_remote_marketplace_config(&home)?;let s=plugin_marketplace::openai_curated_remote_marketplace_status(&home);ensure!(!s.needs_repair(),"marketplace registration not verified");output(json!({"ok":true,"registered":true}));},
  "runtime"=>{
   let root=absolute(&v,"root")?;let app=absolute(&v,"app")?;let port=v["port"].as_u64().filter(|p|*p>1024&&*p<65536).ok_or_else(||anyhow::anyhow!("invalid port"))? as u16;
   let settings=safe_settings(&v["settings"])?;std::fs::create_dir_all(&root)?;SettingsStore::new(root.join("runtime-settings.json")).save(&settings)?;
   let hooks=DefaultLaunchHooks::default();
   let launch=hooks.launch_codex(&app,port,&settings,&[]).await?;
   let mut attached=false;
   for _ in 0..40 {if inject(port,&root,&home,settings.clone()).await.is_ok(){attached=true;break;}tokio::time::sleep(std::time::Duration::from_millis(500)).await;}
   ensure!(attached,"Codex started but enhancement bridge could not attach");
   output(json!({"ok":true,"phase":"running","version":VERSION}));
   hooks.wait_for_codex_exit(&launch,port).await?;
  },
  _=>anyhow::bail!("unsupported action"),
 } Ok(())
}
#[tokio::main]
async fn main(){
 let mut line=String::new();let mut input=BufReader::new(tokio::io::stdin());
 let result=async{let n=input.read_line(&mut line).await?;ensure!(n>0&&n<65536,"invalid request size");execute(serde_json::from_str(&line)?).await}.await;
 if let Err(e)=result {eprintln!("{e:#}");output(json!({"ok":false,"code":"CODEXPP_ENGINE_FAILED"}));std::process::exit(1);}
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn no_provider_or_secret_inheritance(){let s=safe_settings(&json!({"codexAppPasteFix":true})).unwrap();assert!(s.codex_app_paste_fix);assert!(!s.relay_profiles_enabled);assert!(!s.codex_app_force_chinese_locale);assert!(safe_settings(&json!({"relayApiKey":"fake"})).is_err());}
}
