import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { mergeMcpServer } from "./config-core.mjs";

function stamp() { return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
async function exists(pathname) { try { await stat(pathname); return true; } catch { return false; } }

export async function installImageMcp({ codexRoot, managerRoot, componentSource, managerExecutable }) {
  const packageJson = JSON.parse(await readFile(join(componentSource, "package.json"), "utf8"));
  if (packageJson.name !== "777codes-image-mcp") throw new Error("内置 Image MCP 组件身份校验失败");
  const componentRoot = join(managerRoot, "components");
  const target = join(componentRoot, "777codes-image-mcp");
  const skillTarget = join(codexRoot, "skills", "777codes-image");
  const backupRoot = join(managerRoot, "Backups", `image-mcp-${stamp()}-${randomUUID().slice(0, 6)}`);
  const oldComponent = join(backupRoot, "previous-component");
  const oldSkill = join(backupRoot, "previous-skill");
  const configPath = join(codexRoot, "config.toml");
  const configBackup = join(backupRoot, "config.toml");
  const temporaryConfig = `${configPath}.777codex-image.tmp`;

  await mkdir(componentRoot, { recursive: true });
  await mkdir(join(codexRoot, "skills"), { recursive: true });
  await mkdir(backupRoot, { recursive: true });

  const hadComponent = await exists(target);
  const hadSkill = await exists(skillTarget);
  const hadConfig = await exists(configPath);
  try {
    if (hadComponent) await rename(target, oldComponent);
    if (hadSkill) await rename(skillTarget, oldSkill);
    await cp(componentSource, target, { recursive: true, errorOnExist: true });
    await cp(join(componentSource, "skills", "777codes-image"), skillTarget, { recursive: true, errorOnExist: true });

    const wrapper = join(target, "777codes-image-mcp.cmd");
    const script = join(target, "bin", "777codes-image-mcp.mjs");
    const wrapperText = `@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"${managerExecutable}" "${script}" %*\r\n`;
    await writeFile(wrapper, wrapperText, "utf8");

    const currentConfig = hadConfig ? await readFile(configPath, "utf8") : "";
    if (hadConfig) await cp(configPath, configBackup, { errorOnExist: true });
    const merged = mergeMcpServer(currentConfig, { name: "777codes-image", command: wrapper, startupTimeout: 20, toolTimeout: 600 });
    await writeFile(temporaryConfig, merged, "utf8");
    await rename(temporaryConfig, configPath);
    return { ok: true, version: packageJson.version, command: wrapper, skillPath: skillTarget, backupPath: backupRoot };
  } catch (error) {
    await rm(temporaryConfig, { force: true }).catch(() => {});
    await rm(target, { recursive: true, force: true }).catch(() => {});
    await rm(skillTarget, { recursive: true, force: true }).catch(() => {});
    if (hadComponent) await rename(oldComponent, target).catch(() => {});
    if (hadSkill) await rename(oldSkill, skillTarget).catch(() => {});
    if (hadConfig) await cp(configBackup, configPath, { force: true }).catch(() => {});
    else await rm(configPath, { force: true }).catch(() => {});
    throw error;
  }
}

export function imageMcpComponentSource(projectRoot) {
  const unpackedRoot = String(projectRoot).replace(/app\.asar([\\/]|$)/, "app.asar.unpacked$1");
  return join(unpackedRoot, "components", "777codes-image-mcp");
}

export function isManagedImageCommand(command, managerRoot) {
  if (!command) return false;
  return basename(command).toLowerCase() === "777codes-image-mcp.cmd" && command.toLowerCase().startsWith(managerRoot.toLowerCase());
}
