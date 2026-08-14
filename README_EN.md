# DeepSeek Harness Desktop (dsh-desktop)

An Electron desktop client for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
**launching the client boots (or reuses) the Harness gateway and embeds the official web UI**
in its own window — so the interface and every interaction are *identical* to the web version
at `http://127.0.0.1:3080`, because it loads the very same Harness Web UI, not a reimplementation.

> Typical use: after a fresh boot, double-click the client and the Harness backend is up.
> Closing the window keeps the backend running in the tray; reopen instantly.

## Features

- **Boots the gateway on launch**: detects whether a Harness gateway is already on
  `127.0.0.1:3080` — reuses it if yes, otherwise spawns `dsh web` and waits until ready.
- **Identical UI**: embeds the official Harness web UI.
- **Tray resident**: closing the window hides it to the tray while the gateway keeps running.
  Tray menu: Show window / Open in browser / Restart backend / Launch at login (toggle) / Quit.
- **Launch at login** (default off): registers Windows auto-start so the client (and gateway)
  come up at sign-in.
- **Single instance**: repeated launches focus the existing window.
- **Gateway logs**: written to `gateway.log` under the app userData directory; the loading
  page shows a live tail.
- **Configurable**: port, workspace and auto-start can be changed via `settings.json` (below).

## Running

### Portable build (recommended for end users)

Download `dsh-desktop-portable.zip`, extract, and double-click `electron.exe`.

- On first launch it detects/boots the Harness gateway (requires Node.js on PATH and a
  working `dsh web`).
- Default workspace: `%USERPROFILE%\harness-workspace` (changeable via `settings.json`).

### From source (developers)

Requires Node.js ≥ 20 and a usable `dsh` (`@deepseek-ai/dsh`).

```bat
cd harness-desktop
npm install          # first run downloads Electron (~100 MB)
npm start
```

If GitHub is unreachable, install Electron through a mirror:

```bat
set electron_config_cache=%~dp0.electron-cache
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install
```

## Configuration

`settings.json` lives in the Electron userData directory (usually
`%APPDATA%\dsh-desktop\settings.json`):

```json
{
  "port": 3080,
  "openAtLogin": false,
  "workspace": "C:\\Users\\you\\harness-workspace"
}
```

- `port`: gateway port (default 3080). Errors out if occupied by a non-Harness program.
- `openAtLogin`: launch at Windows sign-in (also toggled from the tray).
- `workspace`: working directory for `dsh web` (the Harness default workspace root).
  From source it defaults to the parent of the client folder; for the portable build it
  defaults to `%USERPROFILE%\harness-workspace`.

## Packaging

```bat
npm run build:portable   # produces dist\portable\ — zip it up for distribution
```

To build an installer, use electron-builder:

```bat
npm i -D electron-builder
npx electron-builder --win nsis
```

## Development & testing

```bat
npm run smoke     # gateway-module smoke test (plain Node, no Electron needed)
npm start         # run the desktop client
```

Layout:

```
├── main.js                 # main process: window / tray / lifecycle
├── preload.js              # exposes only gateway-status subscription to the loading page
├── lib/
│   ├── gateway.js          # resolve / spawn / probe / stop the gateway
│   ├── settings.js         # settings persistence
│   ├── tray.js             # tray menu
│   └── icon.js             # generates the tray/window icon in pure Node
├── renderer/               # loading page
└── test/gateway-smoke.mjs  # smoke test
```

## Troubleshooting

- **Gateway fails to start / times out**: quit from the tray, then read the tail of
  `gateway.log` under the userData directory; confirm `dsh web` works manually.
- **Port occupied**: change `port` in `settings.json` (a manually started gateway must use
  the same port).
- **UI different from the web version?** It cannot be — the client loads the official UI.

## License

MIT
