# 分享与提交指南（SHARING）

把 dsh-desktop 分享到 DSH 社区（插件列表 / 仓库）的完整步骤。

## 0. 准备（本仓库已做好）

- [x] 代码通用化：无 `D:\Myharness` 硬编码（README 已改为通用路径）
- [x] `LICENSE`（MIT）、`.gitignore`、中英双语 README
- [x] 便携版打包脚本 `build-portable.cmd` → `dist\dsh-desktop-portable.zip`

## 1. 创建 GitHub 仓库并推送

```bat
cd D:\Myharness\harness-desktop

git init
git add .
git commit -m "dsh-desktop: Electron client that boots/reuses the Harness gateway and embeds the official web UI"
git branch -M main

rem 在 https://github.com/new 创建公开仓库（建议名 dsh-desktop），然后：
git remote add origin https://github.com/<你的用户名>/dsh-desktop.git
git push -u origin main
```

创建后务必在仓库页面给项目打上 **`dsh-plugin`** 标签（Topics，这是 awesome-dsh-plugin 收录的硬性要求）。

## 2. 上传 Release 产物（可选但强烈推荐）

把 `dist\dsh-desktop-portable.zip` 上传到 GitHub Releases（仓库页面 → Releases → Draft a new release），
并把压缩包链接写进 README，方便网友下载即用。

## 3. 提交到社区列表

### 3a. awesome-dsh-plugin（bruc3van，中文生态，913 插件）

收录前提：仓库公开 + 带 `dsh-plugin` topic ✓

- Fork https://github.com/bruc3van/awesome-dsh-plugin
- 只编辑 `data/curated.json`（README/CATALOG 由每日工作流自动刷新，不要提交生成文件）
- 加入推荐（可选，也可只靠 topic 自动进 CATALOG）：

```jsonc
// data/curated.json → category_overrides 增加：
"<你的用户名>/dsh-desktop": "ui-experience"

// scenarios 增加（可选，让它出现在"我想要…"导航）：
{
  "goal_zh": "开机一键拉起 Harness 桌面客户端",
  "goal_en": "Open a Harness desktop client with one click",
  "repos": ["<你的用户名>/dsh-desktop"],
  "why_zh": "双击即拉起/复用 Harness 网关并内嵌官方 Web 界面，托盘常驻、可选开机自启。",
  "why_en": "Double-click boots or reuses the Harness gateway and embeds the official UI; tray-resident with optional launch-at-login."
}
```

- 本地校验：`node scripts/validate-curated.mjs`
- 提 PR（只含 curated.json 的改动）

### 3b. awesome-DSH-plugin（Alex-Yanggg，英文 + 中文镜像）

- Fork https://github.com/Alex-Yanggg/awesome-DSH-plugin
- 改两处：
  1. `README.md` 的 **UI & user experience** 分类加一行
  2. `catalog/plugins.json` 加条目：

```jsonc
{
  "name": "dsh-desktop",
  "url": "https://github.com/<你的用户名>/dsh-desktop",
  "category": "ui-user-experience",
  "description": {
    "en": "Windows desktop client that boots or reuses the Harness gateway and embeds the official web UI.",
    "zh-CN": "Windows 桌面客户端：打开即拉起或复用 Harness 网关，窗口内嵌官方 Web 界面。"
  },
  "status": "active",
  "source": "community"
}
```

- 校验：`python scripts/generate_readmes.py && python scripts/generate_readmes.py --check`
- 提 PR（用仓库提供的模板）

### 3c. 其它列表（可选）

- https://github.com/0xsline/awesome-deepseek-harness
- https://github.com/AdamPlatin123/awesome-dsh-plugins
- GitHub 搜索 topic `dsh-plugin` 找到更多收录渠道

## 4. 项目简介（提交描述用）

**EN**：dsh-desktop — a Windows Electron client for DeepSeek Harness. Launching it boots (or
reuses) the Harness gateway and embeds the official web UI, so the interface is identical to
the web version. Tray-resident, single instance, launch-at-login option, configurable port and
workspace.

**中文**：dsh-desktop — DeepSeek Harness 的 Windows 桌面客户端。打开即自动拉起（或复用）
Harness 网关并内嵌官方 Web 界面（操作逻辑与网页端完全一致）；托盘常驻、单实例、可选开机
自启，端口与工作目录可配置。
