// DeepSeek Harness 桌面客户端 —— 主进程
//
// 行为：
//   1. 打开客户端 → 检测 127.0.0.1:<port> 上是否已有 Harness 网关：
//      有 → 复用；没有 → 自动拉起 `node <dsh>/bin.js web --port <port>`。
//   2. 等待网关就绪后，窗口内嵌加载官方 Web UI（操作逻辑与网页端完全一致）。
//   3. 关闭窗口 → 隐藏到托盘，网关继续在后台运行；托盘"退出" → 停止网关并退出。
//   4. 托盘"开机自启"开关（默认关）→ 注册 Windows 登录自启。
//   5. 单实例：重复打开时聚焦已有窗口。

"use strict";

const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { GatewayManager, resolveDshEntry, resolveNodePath } = require("./lib/gateway");
const { Settings } = require("./lib/settings");
const { createTray } = require("./lib/tray");
const { generateIconPng } = require("./lib/icon");

// 允许测试/调试时把 userData 指到工作区内（沙箱等受限环境）
if (process.env.HARNESS_DESKTOP_USERDATA) {
  app.setPath("userData", process.env.HARNESS_DESKTOP_USERDATA);
}

const APP_ROOT = __dirname;
const isSmoke = process.argv.includes("--smoke");

let mainWindow = null;
let tray = null;
let gateway = null;
let settings = null;
let isQuitting = false;
let bootError = null;
let windowVisible = false;
let lastStatus = null;

// ---------- 单实例 ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());
  app.whenReady().then(boot).catch((err) => {
    console.error("启动失败：", err);
    if (!isSmoke) dialog.showErrorBox("DeepSeek Harness 桌面客户端", `启动失败：\n${err.message}`);
    app.exit(1);
  });
}

// ---------- 窗口 ----------
function createWindow() {
  let iconBuf = null;
  try {
    iconBuf = generateIconPng();
  } catch (err) {
    console.error("生成图标失败：", err);
  }
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#10141d",
    title: "DeepSeek Harness",
    icon: iconBuf || undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(APP_ROOT, "preload.js"),
    },
  });

  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      // 关闭窗口 → 隐藏到托盘，网关继续运行
      e.preventDefault();
      mainWindow.hide();
      windowVisible = false;
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // 只允许在网关页面内导航；外链交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://127.0.0.1:${settings.port}`)) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${settings.port}`)) e.preventDefault();
  });

  // F12 开关开发者工具
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F12") {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (!windowVisible) {
      mainWindow.show();
      windowVisible = true;
    }
  });

  // 加载启动页（网关就绪后切换到真实界面）
  mainWindow.loadFile(path.join(APP_ROOT, "renderer", "loading.html"));
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  windowVisible = true;
}

function sendStatus(state, message, extra = {}) {
  lastStatus = { state, message, ...extra };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("gateway-status", lastStatus);
  }
}

// ---------- 网关 ----------
function buildGatewayManager() {
  const userData = app.getPath("userData");
  const logFile = path.join(userData, "gateway.log");
  const pidFile = path.join(userData, "gateway.pid");
  return new GatewayManager({
    workspace: settings.workspace,
    port: settings.port,
    nodePath: resolveNodePath(),
    dshBinJs: resolveDshEntry(),
    logFile,
    pidFile,
    onLog: (line) => sendStatus("booting", null, { log: line }),
  });
}

async function startGateway() {
  sendStatus("booting", `正在启动 Harness 网关（端口 ${settings.port}）…`);
  const result = await gateway.ensureRunning({ timeoutMs: 150000 });
  return result;
}

async function restartGateway() {
  try {
    sendStatus("booting", "正在重启 Harness 网关…");
    if (gateway) await gateway.stop();
    // 回到加载页
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadFile(path.join(APP_ROOT, "renderer", "loading.html"));
    }
    gateway = buildGatewayManager();
    const result = await startGateway();
    await loadGatewayUI(result.url);
  } catch (err) {
    handleBootError(err);
  }
}

async function loadGatewayUI(url) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  sendStatus("ready", "网关已就绪，正在打开界面…");
  await mainWindow.loadURL(url);
  mainWindow.setTitle("DeepSeek Harness");
}

// E2E 自检：加载完成后抓取页面状态与截图，写入报告（HARNESS_DESKTOP_E2E 时启用）
async function runE2E() {
  const outDir = process.env.HARNESS_DESKTOP_E2E_DIR || app.getPath("userData");
  try {
    const report = await mainWindow.webContents.executeJavaScript(`(async () => {
      await new Promise((r) => setTimeout(r, 4000));
      return {
        title: document.title,
        url: location.href,
        rootChildren: (document.getElementById('root')?.children.length) ?? -1,
        hasChat: !!document.querySelector('textarea, [contenteditable="true"]'),
        bodyText: document.body.innerText.slice(0, 400)
      };
    })()`);
    fs.writeFileSync(path.join(outDir, "e2e-report.json"), JSON.stringify(report, null, 2), "utf8");
    console.log("[e2e] report:", JSON.stringify(report));
    const img = await mainWindow.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, "e2e-shot.png"), img.toPNG());
    console.log("[e2e] screenshot saved to", path.join(outDir, "e2e-shot.png"));
  } catch (err) {
    console.error("[e2e] failed:", err);
  }
}

function handleBootError(err) {
  bootError = err;
  console.error(err);
  sendStatus("error", err.message);
  if (isSmoke) return;
  dialog.showMessageBox({
    type: "error",
    title: "Harness 网关启动失败",
    message: "Harness 网关未能启动。",
    detail: err.message,
    buttons: ["重试", "打开日志目录", "退出"],
    defaultId: 0,
  }).then(({ response }) => {
    if (response === 0) {
      restartGateway();
    } else if (response === 1) {
      shell.openPath(app.getPath("userData"));
    } else {
      quitApp();
    }
  });
}

// ---------- 托盘 ----------
function setupTray() {
  tray = createTray({
    win: mainWindow,
    gateway,
    settings,
    showWindow: () => showMainWindow(),
    restartGateway: () => restartGateway(),
    applyLoginItem: (open) => applyLoginItem(open),
    quit: () => quitApp(),
  });
}

// ---------- 开机自启 ----------
function applyLoginItem(open) {
  const opts = { openAtLogin: open };
  if (app.isPackaged) {
    opts.path = process.execPath;
  } else {
    opts.path = process.execPath;
    opts.args = [APP_ROOT];
  }
  app.setLoginItemSettings(opts);
}

// ---------- 退出 ----------
async function quitApp() {
  if (isQuitting) return;
  isQuitting = true;
  try {
    if (gateway) await gateway.stop();
  } catch (err) {
    console.error("停止网关失败：", err);
  }
  app.quit();
}

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  // 托盘常驻：不因窗口关闭而退出
});

// ---------- 启动 ----------
async function boot() {
  settings = new Settings(app.getPath("userData"), APP_ROOT);

  // 首次运行（无设置文件）时，把"开机自启"状态与系统注册保持一致
  if (!settings.exists) {
    const sysLogin = app.getLoginItemSettings();
    settings.openAtLogin = sysLogin.openAtLogin;
  }
  // 确保系统注册与设置一致（例如应用目录被移动后）
  applyLoginItem(settings.openAtLogin);

  // 加载页订阅就绪后，把当前状态补发过去（避免订阅晚于状态更新的竞态）
  // 注意：必须在 createWindow 之前注册，避免加载页先于监听器发送 ready
  ipcMain.on("loading-ready", () => {
    if (bootError) sendStatus("error", bootError.message);
    else if (lastStatus) sendStatus(lastStatus.state, lastStatus.message, { log: lastStatus.log });
  });

  createWindow();
  setupTray();

  // 先显示加载页（此时网关可能还在启动）
  showMainWindow();

  gateway = buildGatewayManager();
  try {
    const result = await startGateway();
    await loadGatewayUI(result.url);
  } catch (err) {
    handleBootError(err);
  }

  if (isSmoke) {
    if (process.env.HARNESS_DESKTOP_E2E) await runE2E();
    console.log("[smoke] gateway ok, window loaded");
    setTimeout(() => quitApp(), 1000);
  }
}
