import {join, isAbsolute} from 'node:path';
export function runtimePaths({platform,home,root,environment={}}) {
  const isolated=environment.MANAGER777_ISOLATED!=='0';
  const base=platform==='win32' ? (environment.APPDATA||join(home,'AppData','Roaming')) : join(home,'Library','Application Support');
  const override=isolated && environment.MANAGER777_STATE_ROOT;
  if(override&&!isAbsolute(override))throw new Error('隔离目录必须是绝对路径');
  const state=override||(isolated?(platform==='darwin'?join(base,'777Codex-Tauri-Isolated'):join(root,'.dev')):join(base,'777Codex-Tauri-Candidate'));
  return {isolated,state,manager:join(state,'manager'),codex:isolated?join(state,'codex'):join(home,'.codex'),skills:isolated?join(state,'skills'):join(home,'.agents','skills')};
}
