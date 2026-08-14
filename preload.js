// 预加载脚本：仅向加载页暴露"网关状态订阅"与"就绪通知"，不向网页暴露任何 Node 能力。
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("harnessDesktop", {
  onGatewayStatus: (cb) => {
    ipcRenderer.on("gateway-status", (_event, data) => cb(data));
  },
  // 加载页脚本就绪后调用，主进程会补发当前状态，避免竞态
  ready: () => {
    ipcRenderer.send("loading-ready");
  },
});
