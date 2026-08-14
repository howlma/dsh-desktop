// 托盘：常驻后台、显示主界面、重启网关、开机自启开关、退出

"use strict";

const { Menu, Tray, app } = require("electron");
const path = require("node:path");
const { generateIconPng } = require("./icon");

function createTray({ win, gateway, settings, showWindow, restartGateway, applyLoginItem, quit }) {
  let iconBuf;
  try {
    iconBuf = generateIconPng();
  } catch {
    iconBuf = null;
  }
  const icon = iconBuf ? require("electron").nativeImage.createFromBuffer(iconBuf) : null;
  const tray = new Tray(icon || require("electron").nativeImage.createEmpty());
  tray.setToolTip("DeepSeek Harness");

  const rebuild = () => {
    const menu = Menu.buildFromTemplate([
      {
        label: "显示主界面",
        click: showWindow,
      },
      {
        label: "在浏览器中打开",
        click: () => {
          try {
            require("electron").shell.openExternal(`http://127.0.0.1:${settings.port}`);
          } catch {
            /* ignore */
          }
        },
      },
      { type: "separator" },
      {
        label: "重启 Harness 后台",
        click: restartGateway,
      },
      {
        label: "开机自启",
        type: "checkbox",
        checked: settings.openAtLogin,
        click: (item) => {
          settings.openAtLogin = item.checked;
          applyLoginItem(item.checked);
          rebuild();
        },
      },
      { type: "separator" },
      {
        label: "退出",
        click: quit,
      },
    ]);
    tray.setContextMenu(menu);
  };

  rebuild();
  tray.on("click", showWindow); // 单击托盘图标显示主界面
  return tray;
}

module.exports = { createTray };
