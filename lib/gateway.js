// Harness 网关管理（桌面客户端主进程使用）
//
// 职责：
//   1. 解析本机可用的 dsh 启动入口（@deepseek-ai/dsh 的 bin.js）
//   2. 检测网关是否已在目标端口运行（是 → 复用，否 → 拉起）
//   3. 等待网关就绪（轮询 HTTP），超时报错并给出日志尾部
//   4. 退出时按需终止由本客户端拉起的网关进程树
//
// 说明：网关子进程的 stdout/stderr 直接重定向到日志文件（stdio fd），
// 不使用管道——避免长驻进程管道缓冲问题，也让受限环境下的测试可行。

"use strict";

const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const HARNESS_MARKER = "DeepSeek Harness";

/** 在 %LOCALAPPDATA% 或 %APPDATA% 的常见位置查找 dsh 包入口。 */
function findDshBinJs() {
  const candidates = [];
  const local = process.env.LOCALAPPDATA;
  const appdata = process.env.APPDATA;
  if (local) {
    const npxRoot = path.join(local, "npm-cache", "_npx");
    candidates.push(...walkNpxCache(npxRoot));
    // 旧版 npm 可能把全局包放在 LOCALAPPDATA\npm\node_modules
    candidates.push(path.join(local, "npm", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"));
  }
  if (appdata) {
    candidates.push(path.join(appdata, "npm", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"));
  }
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** 枚举 npx 缓存下所有 @deepseek-ai/dsh 包入口（按目录名倒序，优先最新）。 */
function walkNpxCache(npxRoot) {
  const out = [];
  let entries = [];
  try {
    entries = fs
      .readdirSync(npxRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch {
    return out;
  }
  for (const dir of entries) {
    const p = path.join(npxRoot, dir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
    try {
      if (fs.existsSync(p)) out.push(p);
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** 通过 where.exe 找到 dsh 的 .cmd 垫片，反推出包入口。 */
function findDshViaWhere() {
  try {
    const raw = execFileSync("where.exe", ["dsh"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
    const lines = raw.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      if (line.toLowerCase().endsWith(".cmd")) {
        const binDir = path.dirname(line);
        const pkg = path.join(binDir, "..", "@deepseek-ai", "dsh", "lib", "bin.js");
        try {
          if (fs.existsSync(pkg)) return pkg;
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* not found */
  }
  return null;
}

/** 解析系统 node 可执行文件路径。 */
function resolveNodePath() {
  // 1) 显式环境变量
  if (process.env.NODE_EXE) {
    try {
      if (fs.existsSync(process.env.NODE_EXE)) return process.env.NODE_EXE;
    } catch {
      /* ignore */
    }
  }
  // 2) 常见安装路径
  const candidates = [];
  if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, "nodejs", "node.exe"));
  if (process.env["ProgramFiles(x86)"]) candidates.push(path.join(process.env["ProgramFiles(x86)"], "nodejs", "node.exe"));
  candidates.push(path.join(process.env.LOCALAPPDATA || "", "Programs", "nodejs", "node.exe"));
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  // 3) PATH 查找
  try {
    const raw = execFileSync("where.exe", ["node"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
    const line = raw.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (line && fs.existsSync(line)) return line;
  } catch {
    /* fall through */
  }
  return "node";
}

/** 找到 dsh 启动入口；找不到时返回 null（调用方可回退到 npx）。 */
function resolveDshEntry() {
  return findDshBinJs() || findDshViaWhere();
}

class GatewayManager {
  /**
   * @param {object} opts
   * @param {string} opts.workspace  网关工作目录（dsh web 的默认 workspace）
   * @param {number} opts.port       网关端口（默认 3080）
   * @param {string} opts.nodePath   node 可执行文件路径
   * @param {string|null} opts.dshBinJs  dsh bin.js 路径；null 时走 npx 回退
   * @param {string} opts.logFile    网关日志文件路径（追加）
   * @param {string|null} opts.pidFile  记录"本客户端拉起的网关 PID"的状态文件
   * @param {(line: string) => void} [opts.onLog]  日志回调（按行推送新日志）
   */
  constructor(opts) {
    this.workspace = opts.workspace;
    this.port = opts.port;
    this.nodePath = opts.nodePath;
    this.dshBinJs = opts.dshBinJs;
    this.logFile = opts.logFile;
    this.pidFile = opts.pidFile;
    this.onLog = opts.onLog || (() => {});
    this.child = null;
    this.startedByUs = false;
    this.url = `http://127.0.0.1:${this.port}`;
    this._logFd = null;
    this._tailTimer = null;
    this._tailOffset = 0;
  }

  _writeLog(line) {
    try {
      fs.appendFileSync(this.logFile, `[${new Date().toISOString()}] ${line}\n`);
    } catch {
      /* 日志写失败不影响主流程 */
    }
    this.onLog(line);
  }

  /** 启动日志文件尾部监听（子进程直接写文件，主进程轮询转发新行）。 */
  _startTail() {
    try {
      if (!fs.existsSync(this.logFile)) return;
      this._tailOffset = fs.statSync(this.logFile).size;
    } catch {
      this._tailOffset = 0;
    }
    this._tailTimer = setInterval(() => {
      try {
        if (!fs.existsSync(this.logFile)) return;
        const size = fs.statSync(this.logFile).size;
        if (size <= this._tailOffset) return;
        const fd = fs.openSync(this.logFile, "r");
        const buf = Buffer.alloc(size - this._tailOffset);
        fs.readSync(fd, buf, 0, buf.length, this._tailOffset);
        fs.closeSync(fd);
        this._tailOffset = size;
        const text = buf.toString("utf8");
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) this.onLog(line.replace(/^\[[^\]]+\]\s*/, ""));
        }
      } catch {
        /* ignore */
      }
    }, 600);
    this._tailTimer.unref?.();
  }

  _stopTail() {
    if (this._tailTimer) {
      clearInterval(this._tailTimer);
      this._tailTimer = null;
    }
    if (this._logFd !== null) {
      try {
        fs.closeSync(this._logFd);
      } catch {
        /* ignore */
      }
      this._logFd = null;
    }
  }

  /**
   * 检查端口上是否已经跑着 Harness。
   * @returns {Promise<"harness" | "other" | "down">}
   */
  async probe() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch(this.url + "/", { signal: controller.signal, redirect: "manual" });
      const text = await res.text();
      clearTimeout(timer);
      return text.includes(HARNESS_MARKER) || text.includes('id="root"') ? "harness" : "other";
    } catch {
      clearTimeout(timer);
      return "down";
    }
  }

  /** 轮询等待网关可访问。 */
  async waitReady({ timeoutMs = 120000, intervalMs = 400 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastProbe = "down";
    while (Date.now() < deadline) {
      lastProbe = await this.probe();
      if (lastProbe === "harness") return true;
      if (lastProbe === "other") return false; // 端口被非 Harness 程序占用
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return lastProbe === "harness";
  }

  /**
   * 确保网关在运行。
   * @returns {Promise<{started: boolean, reused: boolean, url: string}>}
   */
  async ensureRunning({ timeoutMs = 120000 } = {}) {
    const probe = await this.probe();
    if (probe === "harness") {
      this._writeLog(`网关已在 ${this.url} 运行，直接复用`);
      this.startedByUs = false;
      // 清理可能遗留的 pid 标记：复用的网关不属于本会话，退出时不应停止它
      if (this.pidFile) {
        try {
          fs.rmSync(this.pidFile, { force: true });
        } catch {
          /* ignore */
        }
      }
      return { started: false, reused: true, url: this.url };
    }
    if (probe === "other") {
      throw new Error(`端口 ${this.port} 已被其它程序占用（不是 Harness）。请在设置中更换端口，或先停止占用端口的程序。`);
    }

    const dshEntry = this.dshBinJs || resolveDshEntry();
    // 直接以 node 运行 dsh bin.js：第一个参数必须是脚本路径
    const args = dshEntry
      ? [dshEntry, "web", "--port", String(this.port)]
      : ["--yes", "@deepseek-ai/dsh", "web", "--port", String(this.port)];
    const program = dshEntry ? this.nodePath : "npx.cmd";
    this._writeLog(`启动网关：${program} ${args.join(" ")}（工作目录：${this.workspace}）`);

    // 子进程 stdout/stderr 直接写日志文件，避免管道
    let logFd = -1;
    try {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      logFd = fs.openSync(this.logFile, "a");
    } catch {
      logFd = -1;
    }
    this._logFd = logFd >= 0 ? logFd : null;

    const child = spawn(program, args, {
      cwd: this.workspace,
      env: { ...process.env },
      windowsHide: true,
      stdio: logFd >= 0 ? ["ignore", logFd, logFd] : ["ignore", "ignore", "ignore"],
    });
    this.child = child;
    this.startedByUs = true;
    if (this.pidFile) {
      try {
        fs.writeFileSync(this.pidFile, String(child.pid), "utf8");
      } catch {
        /* ignore */
      }
    }
    child.on("exit", (code, signal) => {
      this._writeLog(`网关进程退出 code=${code} signal=${signal}`);
      this._stopTail();
      if (this.pidFile) {
        try {
          fs.rmSync(this.pidFile, { force: true });
        } catch {
          /* ignore */
        }
      }
      this.child = null;
    });
    child.on("error", (err) => {
      this._writeLog(`网关进程启动错误：${err.message}`);
    });
    this._startTail();

    const ready = await this.waitReady({ timeoutMs });
    if (!ready) {
      const tail = this.readLogTail(40);
      throw new Error(`网关启动超时或失败（${Math.round(timeoutMs / 1000)} 秒内未就绪）。\n\n最近日志：\n${tail}`);
    }
    this._writeLog(`网关就绪：${this.url}`);
    return { started: true, reused: false, url: this.url };
  }

  readLogTail(lines = 30) {
    try {
      if (!fs.existsSync(this.logFile)) return "(无日志)";
      const content = fs.readFileSync(this.logFile, "utf8");
      const arr = content.split(/\r?\n/).filter(Boolean);
      return arr.slice(-lines).join("\n");
    } catch {
      return "(无法读取日志)";
    }
  }

  /**
   * 停止网关。仅当网关由本客户端拉起（本次会话或 pid 文件标记）时才终止进程树。
   * @returns {Promise<void>}
   */
  async stop() {
    this._stopTail();
    let pid = this.child ? this.child.pid : null;
    if (pid === null && this.pidFile) {
      // 仅当端口上确实有 Harness 时才信任 pid 标记：
      // 避免崩溃遗留的 pid 被系统回收给无关进程后误杀
      const p = await this.probe();
      if (p === "harness") {
        try {
          const raw = fs.readFileSync(this.pidFile, "utf8").trim();
          const n = Number(raw);
          if (Number.isInteger(n) && n > 0) pid = n;
        } catch {
          /* ignore */
        }
      } else {
        try {
          fs.rmSync(this.pidFile, { force: true });
        } catch {
          /* ignore */
        }
      }
    }
    if (pid === null) {
      this._writeLog("未发现本客户端拉起的网关进程，无需停止");
      return;
    }
    this._writeLog(`停止网关进程树（PID ${pid}）`);
    // 1) taskkill /T 终止整棵进程树，/F 强制（个别受限环境可能被拒）
    try {
      execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 10000, stdio: "ignore" });
    } catch (err) {
      this._writeLog(`taskkill 失败（${err.message?.split("\n")[0] || "未知错误"}），改用直接终止`);
    }
    // 2) 直接终止子进程：父进程持有句柄，通常总能成功
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        /* 进程可能已退出 */
      }
    }
    // 等待端口真正释放（进程树杀干净需要一点时间）
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        if ((await this.probe()) === "down") break;
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    if (this.pidFile) {
      try {
        fs.rmSync(this.pidFile, { force: true });
      } catch {
        /* ignore */
      }
    }
    this.child = null;
    this.startedByUs = false;
  }
}

module.exports = { GatewayManager, resolveDshEntry, resolveNodePath };
