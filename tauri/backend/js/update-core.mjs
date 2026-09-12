import { createHash, verify } from "node:crypto";
import { AppError } from "./errors.mjs";

const MAX_NOTES = 4_000;
const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;
const MAX_FILES = 10_000;
function packagePath(value){
  if(typeof value!=="string"||!value||value.length>500||value.includes("\\")||value.startsWith("/")||/^[A-Za-z]:/.test(value)||value.includes(":"))throw new AppError("更新包文件路径无效","UPDATE_MANIFEST_INVALID",502);
  const parts=value.split("/");if(parts.some(part=>!part||part==="."||part===".."||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))throw new AppError("更新包文件路径无效","UPDATE_MANIFEST_INVALID",502);
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function manifestSignaturePayload(manifest) {
  const copy = { ...manifest, package: { ...manifest.package } };
  delete copy.package.signature;
  return Buffer.from(stable(copy), "utf8");
}

function integer(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new AppError(`更新清单 ${name} 无效`, "UPDATE_MANIFEST_INVALID", 502);
  return value;
}

export function validateUpdateManifest(value, { product, channel, platform, arch, publicKey }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("更新清单格式无效", "UPDATE_MANIFEST_INVALID", 502);
  if (value.schemaVersion !== 2 || value.product !== product || value.channel !== channel || value.platform !== platform || value.arch !== arch) throw new AppError("更新清单不属于当前系统或芯片", "UPDATE_MANIFEST_MISMATCH", 409);
  if (!/^\d+\.\d+\.\d+$/.test(String(value.version || ""))) throw new AppError("更新版本号格式无效", "UPDATE_MANIFEST_INVALID", 502);
  integer(value.revision, "revision"); integer(value.minimumRevision, "minimumRevision");
  if (value.minimumRevision > value.revision) throw new AppError("更新清单最低版本范围无效", "UPDATE_MANIFEST_INVALID", 502);
  if (!Number.isFinite(Date.parse(value.publishedAt))) throw new AppError("更新发布日期无效", "UPDATE_MANIFEST_INVALID", 502);
  if (typeof value.notes !== "string" || value.notes.length > MAX_NOTES) throw new AppError("更新说明无效", "UPDATE_MANIFEST_INVALID", 502);
  const pkg = value.package;
  if (!pkg || pkg.kind !== "full-release-zip") throw new AppError("当前客户端不支持此更新包类型", "UPDATE_PACKAGE_UNSUPPORTED", 409);
  const url = new URL(String(pkg.url || ""));
  if (url.protocol !== "https:" || url.hostname !== "top777ai.com" || url.port || url.username || url.password || url.search || url.hash || !url.pathname.startsWith("/downloads/777codex/")) {
    throw new AppError("更新包地址不在 777codes 可信下载范围", "UPDATE_URL_REJECTED", 409);
  }
  integer(pkg.bytes, "package.bytes");
  if (pkg.bytes < 1 || pkg.bytes > MAX_PACKAGE_BYTES) throw new AppError("更新包大小超出允许范围", "UPDATE_PACKAGE_SIZE_INVALID", 409);
  if (!/^[a-f0-9]{64}$/i.test(String(pkg.sha256 || ""))) throw new AppError("更新包摘要无效", "UPDATE_MANIFEST_INVALID", 502);
  if(!Array.isArray(pkg.files)||pkg.files.length<1||pkg.files.length>MAX_FILES)throw new AppError("更新包文件清单无效","UPDATE_MANIFEST_INVALID",502);
  const names=new Set();let expanded=0;
  for(const file of pkg.files){const path=packagePath(file?.path);const folded=path.toLowerCase();if(names.has(folded))throw new AppError("更新包文件路径重复","UPDATE_MANIFEST_INVALID",502);names.add(folded);integer(file.bytes,"package.files.bytes");integer(file.mode,"package.files.mode");if(file.mode>0o777)throw new AppError("更新包文件权限无效","UPDATE_MANIFEST_INVALID",502);expanded+=file.bytes;if(!/^[a-f0-9]{64}$/i.test(String(file.sha256||"")))throw new AppError("更新包文件摘要无效","UPDATE_MANIFEST_INVALID",502);}
  if(expanded<1||expanded>1024*1024*1024)throw new AppError("更新包解压大小超出允许范围","UPDATE_PACKAGE_SIZE_INVALID",409);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(String(pkg.signature || ""))) throw new AppError("更新签名格式无效", "UPDATE_SIGNATURE_INVALID", 409);
  let verified = false;
  try { verified = verify(null, manifestSignaturePayload(value), publicKey, Buffer.from(pkg.signature, "base64")); } catch {}
  if (!verified) throw new AppError("更新清单签名验证失败", "UPDATE_SIGNATURE_INVALID", 409);
  return { ...value, package: { ...pkg, sha256: pkg.sha256.toLowerCase(), url: url.href,files:pkg.files.map(file=>({...file,sha256:file.sha256.toLowerCase()})) } };
}

function versionParts(value) { return String(value).split(".").map(Number); }
export function compareBuild(left, right) {
  const a = versionParts(left.version); const b = versionParts(right.version);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return Number(left.revision) - Number(right.revision);
}

export function sha256Buffer(value) { return createHash("sha256").update(value).digest("hex"); }
