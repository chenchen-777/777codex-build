import {writeFile} from 'node:fs/promises';
export async function runMacSmoke({app,window}) {
  try {
    await new Promise(resolve=>setTimeout(resolve,2500));
    const result=await window.webContents.executeJavaScript(`(async()=>{
      const checks={};
      for(const path of ['/api/health','/api/local-state','/api/providers','/api/extensions/mcp','/api/extensions/skills','/api/sessions']) {
        const r=await fetch(path); if(!r.ok)throw new Error(path+' HTTP '+r.status); checks[path]=await r.json();
      }
      if(!window.manager777||!window.manager777Mac)throw new Error('UI not initialized');
      if(!checks['/api/health'].isolated||checks['/api/health'].platform!=='darwin')throw new Error('Wrong runtime');
      const logo=document.querySelector('img');if(!logo?.naturalWidth)throw new Error('Logo missing');
      if(getComputedStyle(document.querySelector('#codex-installer-panel')).display!=='none')throw new Error('Windows installer visible');
      return {ok:true,platform:checks['/api/health'].platform,arch:checks['/api/health'].arch,checks:Object.keys(checks),logo:true,macUi:true,windowSize:[innerWidth,innerHeight]};
    })()`);
    await writeFile(process.env.MANAGER777_MAC_SMOKE.replace(/\.json$/,'.png'),(await window.webContents.capturePage()).toPNG());
    await writeFile(process.env.MANAGER777_MAC_SMOKE,JSON.stringify(result,null,2));app.exit(0);
  } catch(error) {
    console.error('Packaged UI smoke failed:',error.message);
    await writeFile(process.env.MANAGER777_MAC_SMOKE,JSON.stringify({ok:false,error:error.message}));app.exit(1);
  }
}
