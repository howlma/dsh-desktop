# DeepSeek Harness 桌面客户端（dsh-desktop）

一个 Electron 桌面客户端：**打开客户端即自动启动（或复用）Harness 网关**，窗口内直接嵌
入官方 Web 界面——界面与操作逻辑和网页端 `http://127.0.0.1:3080` **完全一致**，因为加载
的就是同一个 Harness Web UI，而不是重新仿制。

> 适用场景：电脑刚开机时，双击客户端即可拉起 Harness 后台；关窗后台继续跑（托盘常驻），
> 随时秒开。

## 功能

- **打开即启动网关**：启动时检测 `127.0.0.1:3080` 是否已有 Harness 网关在运行——
  有则直接复用，没有则自动拉起 `dsh web` 并等待就绪后加载界面。
- **界面与网页端 100% 一致**：窗口内嵌官方 Web UI，操作逻辑天然一致。
- **托盘常驻**：关闭窗口只是隐藏到托盘，网关继续在后台运行；托盘菜单提供
  「显示主界面 / 在浏览器中打开 / 重启后台 / 开机自启开关 / 退出」。
- **开机自启开关**：托盘一键开启（默认关），开启后 Windows 登录时自动启动客户端并拉起网关。
- **单实例**：重复打开只会聚焦已有窗口。
- **网关日志**：写入 userData 目录（一般 `%APPDATA%\dsh-desktop\`）下的 `gateway.log`，
  启动页实时显示。
- **可配置**：端口、工作目录、开机自启均可通过 `settings.json` 调整（见下）。

## 运行方式

### 方式一：便携版（推荐给普通用户）

下载 `dsh-desktop-portable.zip`，解压后双击 `electron.exe` 即可。

- 首次启动会自动检测并拉起 Harness 网关（需要本机已安装 Node.js 且 `dsh web` 可用）。
- 默认工作区为 `%USERPROFILE%\harness-workspace`，可在 `settings.json` 中修改。

### 方式二：源码运行（开发者）

需要 Node.js ≥ 20 且本机 `dsh`（`@deepseek-ai/dsh`）可用。

```bat
cd harness-desktop
npm install          # 首次安装 Electron（约 100MB）
npm start
```

Windows 网络受限时，安装 Electron 可走镜像：

```bat
set electron_config_cache=%~dp0.electron-cache
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install
```

## 配置

设置文件位于 Electron 的 userData 目录（一般 `%APPDATA%\dsh-desktop\settings.json`），
支持字段：

```json
{
  "port": 3080,
  "openAtLogin": false,
  "workspace": "C:\\Users\\you\\harness-workspace"
}
```

- `port`：网关端口，默认 `3080`。若该端口被其它程序占用，客户端会报错并提示。
- `openAtLogin`：开机自启（也可通过托盘菜单开关）。
- `workspace`：`dsh web` 的工作目录（Harness 的默认 workspace 根目录）。
  源码运行默认取客户端目录的上一级；便携版默认 `%USERPROFILE%\harness-workspace`。

## 打包

```bat
npm run build:portable   # 生成 dist\portable\ 目录，压缩为 zip 即便携版
```

如需制作安装程序，可用 electron-builder：

```bat
npm i -D electron-builder
npx electron-builder --win nsis
```

## 开发与测试

```bat
npm run smoke     # 网关管理模块冒烟测试（纯 Node，无需 Electron）
npm start         # 启动桌面客户端
```

代码结构：

```
├── main.js                 # 主进程：窗口/托盘/生命周期
├── preload.js              # 仅向加载页暴露网关状态订阅
├── lib/
│   ├── gateway.js          # 网关解析、拉起、探测、停止
│   ├── settings.js         # 设置读写
│   ├── tray.js             # 托盘菜单
│   └── icon.js             # 纯 Node 生成托盘/窗口图标
├── renderer/               # 启动加载页
└── test/gateway-smoke.mjs  # 冒烟测试
```

## 常见问题

- **网关启动失败/超时**：托盘 → 退出后，查看 userData 目录下的 `gateway.log` 日志尾部；
  确认 `dsh web` 手动可以启动。
- **端口被占用**：`settings.json` 换一个端口（手动启动的网关也要用同端口）。
- **界面和网页端不一样？** 不会——客户端加载的就是官方 Web UI 本身。

## License

MIT
