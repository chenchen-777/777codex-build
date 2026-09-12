import TOML from '@iarna/toml';

// Official account mode deliberately never reuses a third-party API credential.
export function officialConfig(text) {
 const config=TOML.parse(text||'');
 delete config.profile;
 delete config.model;
 delete config.model_reasoning_effort;
 delete config.model_reasoning_summary;
 config.model_provider='openai';
 config.forced_login_method='chatgpt';
 config.cli_auth_credentials_store='file';
 if(config.model_providers) delete config.model_providers.openai;
 return TOML.stringify(config);
}
export function assertOfficialEnvironment(env) {
 for(const key of ['OPENAI_API_KEY','OPENAI_BASE_URL','CODEX_API_KEY']) {
  if(env[key]) throw new Error(`环境中设置了 ${key}，请先移除该覆盖后再使用官方连接。不会自动修改系统环境。`);
 }
}
