import { open, lstat } from 'node:fs/promises';
import { join } from 'node:path';

const ORIGIN = 'https://www.777codes.codes';
function invalid() {
  return Object.assign(new Error('分享包的邀请信息损坏或不完整。请向分享者重新索取安装包；不会自动改为无邀请注册。'), {code:'INCOMING_REFERRAL_INVALID',status:409});
}
export async function registrationTarget(bundleRoot) {
  const path = join(bundleRoot, 'referral.json');
  let info;
  try { info = await lstat(path); } catch (e) { if (e.code !== 'ENOENT') throw invalid(); }
  let redirect = '/download/777codex';
  let invited = false;
  if (info) {
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16384) throw invalid();
    let file;
    try {
      file = await open(path, 'r');
      const current = await file.stat();
      if (current.ino !== info.ino || current.size !== info.size || !current.isFile()) throw invalid();
      // Bound reads even if a different process grows the descriptor.
      const bytes = Buffer.alloc(16385);
      const {bytesRead} = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead > 16384) throw invalid();
      const value = JSON.parse(bytes.subarray(0,bytesRead).toString('utf8'));
      const url = new URL(value.share_url);
      if (value.schema !== '777codes-share-v1' || url.origin !== ORIGIN || url.username || url.password || url.hash || url.pathname !== '/download/777codex' || url.searchParams.getAll('ref').length !== 1 || [...url.searchParams.keys()].some(k=>k!=='ref') || !/^[A-Za-z0-9_-]{8,128}$/.test(value.public_ref || '') || value.public_ref !== url.searchParams.get('ref')) throw invalid();
      redirect = url.pathname + url.search;
      invited = true;
    } catch { throw invalid(); } finally { await file?.close(); }
  }
  const url = new URL('/register', ORIGIN);
  url.searchParams.set('redirect', redirect);
  return {url:url.href, invited};
}
