// 客户端设置：持久化到 Electron userData 目录下的 settings.json

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULTS = {
  port: 3080,
  openAtLogin: false,
  workspace: null, // null → 运行时动态计算默认工作区
};

class Settings {
  constructor(userDataDir, appRootDir) {
    this.file = path.join(userDataDir, "settings.json");
    this.appRootDir = appRootDir;
    this.exists = false; // 设置文件是否已存在（用于首次运行判断）
    this.data = { ...DEFAULTS };
    this.load();
  }

  load() {
    try {
      let raw = fs.readFileSync(this.file, "utf8");
      // 兼容带 BOM 的编辑器保存（如记事本另存为 UTF-8 with BOM）
      if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
      const parsed = JSON.parse(raw);
      this.exists = true;
      this.data = { ...this.data, ...parsed };
    } catch {
      // 首次运行或损坏时用默认值
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), "utf8");
      return true;
    } catch {
      return false;
    }
  }

  get port() {
    const p = Number(this.data.port);
    return Number.isInteger(p) && p > 0 && p < 65536 ? p : DEFAULTS.port;
  }

  get workspace() {
    const w = this.data.workspace;
    if (w) {
      try {
        if (fs.existsSync(w)) return w;
      } catch {
        /* ignore */
      }
    }
    // 打包/便携版（应用位于 resources/app 下）：默认用用户目录下的工作区
    const bundled =
      path.basename(this.appRootDir) === "app" &&
      path.basename(path.dirname(this.appRootDir)) === "resources";
    const dflt = bundled
      ? path.join(os.homedir(), "harness-workspace")
      : path.resolve(this.appRootDir, "..");
    try {
      fs.mkdirSync(dflt, { recursive: true });
    } catch {
      /* 创建失败则原样返回，网关启动时会给出明确报错 */
    }
    return dflt;
  }

  set openAtLogin(v) {
    this.data.openAtLogin = !!v;
    this.save();
  }

  get openAtLogin() {
    return !!this.data.openAtLogin;
  }
}

module.exports = { Settings, DEFAULTS };
