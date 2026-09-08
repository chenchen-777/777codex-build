use aes_gcm::{aead::{Aead, KeyInit, OsRng, rand_core::RngCore}, Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD, Engine};
use fs2::FileExt;
use security_framework::passwords::{get_generic_password, set_generic_password};
use std::{fs::OpenOptions, os::unix::fs::OpenOptionsExt};

const PREFIX: &str = "tauri-keychain-v1:";
pub fn crypt(value: &str, decrypt: bool) -> Result<String, String> {
    // Keychain holds one AES key; JSON holds authenticated ciphertext only.
    // Serialise first-key creation across helper processes without a plaintext key file.
    let home = std::env::var_os("HOME").ok_or("用户目录不可用")?;
    let isolated = std::env::var("MANAGER777_ISOLATED").as_deref() == Ok("1");
    let service = if isolated { "codes.777.manager.tauri.test" } else { "codes.777.manager.tauri" };
    let folder = std::path::PathBuf::from(home).join("Library/Application Support").join(service);
    std::fs::create_dir_all(&folder).map_err(|_| "安全存储目录不可用")?;
    let lock = OpenOptions::new().create(true).read(true).write(true).mode(0o600)
        .open(folder.join("vault.lock")).map_err(|_| "安全存储锁不可用")?;
    lock.lock_exclusive().map_err(|_| "安全存储正忙")?;
    let mut key = match get_generic_password(service, "vault-key-v1") {
        Ok(key) => key,
        Err(error) if error.code() == -25300 && !decrypt => {
            let mut key = vec![0u8; 32]; OsRng.fill_bytes(&mut key);
            if set_generic_password(service, "vault-key-v1", &key).is_err() {
                key.fill(0); return Err("无法写入 macOS 钥匙串，未保存明文凭证".into());
            }
            key
        },
        Err(_) => return Err("无法读取 macOS 钥匙串，请解锁钥匙串并允许访问后重试".into()),
    };
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "钥匙串密钥格式无效".to_string());
    key.fill(0);
    let cipher = cipher?;
    drop(lock);
    if decrypt {
        let raw = STANDARD.decode(value.strip_prefix(PREFIX).ok_or("旧版凭证不能直接解密，请重新网页登录并同步 Key")?)
            .map_err(|_| "凭证格式无效")?;
        if raw.len() < 28 { return Err("凭证格式无效".into()); }
        let clear = cipher.decrypt(Nonce::from_slice(&raw[..12]), &raw[12..]).map_err(|_| "凭证解密失败")?;
        String::from_utf8(clear).map_err(|_| "凭证编码无效".into())
    } else {
        let mut nonce = [0u8; 12]; OsRng.fill_bytes(&mut nonce);
        let encrypted = cipher.encrypt(Nonce::from_slice(&nonce), value.as_bytes()).map_err(|_| "凭证加密失败")?;
        let mut result = nonce.to_vec(); result.extend(encrypted);
        Ok(format!("{PREFIX}{}", STANDARD.encode(result)))
    }
}
