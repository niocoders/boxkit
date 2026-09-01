# BoxKit — 跨平台效率启动器与插件平台

对标 uTools 的面板式启动器：全局快捷键唤起搜索面板，聚合**应用 / 系统命令 / 插件功能 / 网络搜索兜底**，插件以沙箱 Web 视图运行，内置**插件市场**（纯客户端 + GitHub Pages 静态市场），支持 `.bkx` 插件包分发与离线授权激活。**纯客户端项目，无任何自建服务端。**

## 特性一览（uTools 对标）

- **搜索面板**：uTools 式固定 760×600 面板、托盘常驻 + 全局快捷键（mac `Option+Space`，Win/Linux `Alt+Space`，设置页**录制控件**可改，冲突检测提示）、失焦自动隐藏
- **智能排序**：使用频率加权 + 空输入展示「最近使用」（uTools 行为一致）
- **关键字高亮**：命中部分蓝色高亮
- **副命令**：插件结果按 `→` 展开该功能全部关键字（uTools 交互），`←`/Esc 收起
- **应用扫描**：macOS `.app` / Windows 开始菜单 `.lnk`（PowerShell 批量解析目标）/ Linux XDG `.desktop`（含 Flatpak 导出目录），后台预热图标
- **系统命令**：睡眠 / 锁屏 / 清空废纸篓 / 任务管理器（Win）/ 资源管理器重启（Win）等，按平台提供
- **插件系统**：zod 强校验清单、`.bkx` 安装（拖入/双击/设置页）、权限逐项确认、沙箱视图 + `bk-plugin://` 协议、开发目录热重载（自动弹 DevTools）、子输入框接管
- **插件市场（纯静态）**：插件源码放仓库 `plugins/` 下，CI（`pages.yml`）自动打包 `.bkx` + 生成 `manifest.json` 并部署到 **GitHub Pages** 市场门户（浏览/搜索/**一键导入 BoxKit**/下载 .bkx）；客户端内置市场页（设置 → 插件）直接消费清单并做 sha256 校验，支持 `boxkit-market://install/<id>` 协议自动导入。详见[「插件市场（GitHub Pages）」](#插件市场github-pages)
- **官方插件**：剪贴板历史、DevToolbox（时间戳/JSON/UUID）
- **自动更新**：electron-updater + 本地更新服务器示例
- **健壮性**：Sentry 崩溃上报（可选）+ 本地 crash 日志兜底、结构化日志

## 三端状态

| 平台 | 应用扫描 | 系统命令 | 快捷键 | 打包 target | 状态 |
|---|---|---|---|---|---|
| macOS (arm64/x64) | ✅ 75+ 应用 | ✅ | `Option+Space` | dmg + zip | ✅ 已验证 |
| Windows (x64) | ✅ 开始菜单 | ✅ | `Alt+Space` | NSIS + zip | ✅ 本机验证 |
| Linux (x64) | ✅ XDG `.desktop` | ✅（systemd/gio） | `Alt+Space` | AppImage + deb + tar.gz | ⚙️ CI 构建（tar.gz 可本机产出） |

> Linux AppImage/deb 与 macOS 产物无法在 Windows 上直接构建（electron-builder 平台限制），已提供 [GitHub Actions 三端发布流水线](#github-actions-三端发布)，push tag 即可产出全部平台安装包；Linux 也可用 `pnpm dist:linux` 产出 tar.gz 兜底包。

## 从源码构建

要求：**Node ≥ 20**、**pnpm ≥ 10**。

```bash
pnpm install

# Electron/electron-builder 二进制走 npmmirror（本仓库 .npmrc 已内置）；
# 若直连 GitHub 正常可忽略。失败时手动补一次：
#   ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node node_modules/electron/install.js
```

常用命令：

```bash
pnpm typecheck   # TS 严格模式类型检查
pnpm test        # vitest 单测（搜索评分 / 清单校验 / 授权 + CLI 互操作）
pnpm build       # esbuild(main/preload) + vite(渲染层) → apps/desktop/dist
pnpm dev         # 开发模式（渲染层 HMR；改主进程代码需重启 electron）
pnpm market      # 构建静态插件市场（market/：.bkx + manifest.json）
pnpm dist        # 打包当前平台全部 target → apps/desktop/release/

# 冒烟自检（无头友好，初始化后自动退出）：
cd apps/desktop && BOXKIT_SMOKE=1 npx electron . --no-sandbox
# 预期输出 BOXKIT_SMOKE_OK {"ok":true,"apps":>0,"plugins":["clipboard-history","devtoolbox"],...}
```

## 分发打包（三端）

所有产物输出到 `apps/desktop/release/`，配置见 [`apps/desktop/electron-builder.yml`](apps/desktop/electron-builder.yml)。

### Windows（当前开发机即可）

```bash
cd apps/desktop && npx electron-builder --win
# 产物：BoxKit Setup <version>.exe（NSIS 安装器）、BoxKit-<version>-win.zip（便携/自动更新）
```

- NSIS 已配置 `.bkx` 文件关联；双击 `.bkx` 会拉起已安装的 BoxKit 进入安装确认。
- zip 与 NSIS 均生成 `latest.yml`，供 Windows 端自动更新。

### macOS（需 macOS 机器或 CI）

```bash
cd apps/desktop && npx electron-builder --mac
# 产物：BoxKit-<version>-{arm64,x64}.dmg + .zip（zip 是 mac 自动更新的必需格式）
```

- 签名与公证：设置 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` 后把 `mac.notarize` 改为 `true`；entitlements 在 `build/entitlements.mac.plist`。无签名分发时 Gatekeeper 需右键打开。
- 面板形态：`LSUIElement` 已配置，不进 Dock，用快捷键或托盘唤起。

### Linux（建议 CI）

```bash
cd apps/desktop && npx electron-builder --linux
# 产物：BoxKit-<version>.AppImage、boxkit_<version>_amd64.deb（Linux/macOS 主机）
# Windows 主机可用 pnpm dist:linux 产出 tar.gz 兜底包（AppImage/deb 需 Linux 工具链）
```

- AppImage 在无 compositor 环境下透明面板可能显示为黑底圆角；宿主托盘行为随桌面环境而异。
- `.deb` 构建依赖 fpm 辅助二进制（Linux/macOS 主机可用），Windows 主机请走 CI。

## GitHub Actions 三端发布

`.github/workflows/release.yml`：push tag `v*` 触发，三个系统矩阵并行构建并上传产物到 GitHub Release：

```bash
git tag v1.0.1 && git push --tags
```

macOS job 会执行 `--mac`（dmg+zip），Linux job 执行 `--linux`（AppImage+deb），Windows job 执行 `--win`（NSIS+zip）；签名证书/公证密钥通过仓库 Secrets 注入（未配置则出未签名包）。

## 自动更新端到端验证

```bash
# 1. 起本地更新服务器（指向 release 产物目录）
node tools/update-server/server.mjs apps/desktop/release 8964

# 2. 安装当前版本客户端 → 设置 → 通用 → 更新服务器填 http://127.0.0.1:8964/
# 3. 放入更高版本的安装包并修改 latest(-mac).yml 模拟新版本 → 「检查更新」→ 下载 → 重启并更新
```


## 隐私声明

BoxKit **不收集、不上传任何用户数据**：

- 应用扫描、插件数据、授权信息、日志均保存在本机 userData 目录（`%APPDATA%/BoxKit`、`~/Library/Application Support/BoxKit`、`~/.config/BoxKit`）。
- 「检查更新」「网络搜索」「需要联网的插件」是仅有的出网行为；崩溃上报默认关闭，可在设置 → 通用中开启（开启后仅上报堆栈与系统版本，见 `services/crash.ts`）。

## 插件市场（GitHub Pages）

市场**没有服务端**：清单与插件包都是静态文件，由 GitHub Pages 托管。市场站点放在**公开仓 `niocoders/boxkit-market`**（Pages 免费承载；主仓保持私有），客户端与门户的默认地址即 `https://niocoders.github.io/boxkit-market`。

```
plugins/<id>/                # 插件源码（plugin.json + 入口/资源），入库
        │  push 触发主仓 CI
        ▼
tools/build-market.mjs       # 校验清单 → 打包 .bkx（stored zip）→ 复制 logo → 生成 manifest.json
        ▼
market/                      # 生成物（.gitignore，不入库）
  index.html                 #   门户页（入库）：浏览/搜索/一键导入/下载
  manifest.json              #   插件条目（fileUrl/logoUrl 相对路径 + sha256 + keywords）
  plugins/*.bkx  logo/*      #   插件包与 logo
        ▼
pages.yml（主仓 CI）推送 market/ 到公开仓 boxkit-market
        ▼
公开仓 Pages：
  ├── 浏览器访问门户：https://niocoders.github.io/boxkit-market/
  └── 客户端「设置 → 插件 → 插件市场」拉取 manifest.json（默认同上，可在设置修改）
```

- **发布插件**：把插件目录提交到 `plugins/` 下并 push → CI 自动打包并发布到市场仓，无需任何人工发布动作。
- **本地验证**：`pnpm market` 生成 `market/`，任意静态服务器（如 `npx serve market`）托管后，在客户端「设置 → 通用 → 插件市场地址」填本地地址即可联调。
- **安装方式**：门户「导入到 BoxKit」（`boxkit-market://` 协议，客户端内自动下载安装）、门户「下载 .bkx」（客户端设置页手动安装）、客户端市场页直接安装，三条链路共用同一套 `stageInstall` 校验。
- **部署前提**：主仓 Actions Secrets 配置 `MARKET_PAT`（拥有 `boxkit-market` 推送权的 classic PAT，scope 至少 `public_repo`；`GITHUB_TOKEN` 无法跨仓库推送）。

## 插件开发

见 [docs/plugin-dev.md](docs/plugin-dev.md)：清单 schema、权限模型、`window.bk` API、调试与 `.bkx` 打包。模板在 `packages/plugin-template`。

## 目录结构

```
apps/desktop/src/main/
  index.ts                  # 入口：生命周期总装 + BOXKIT_SMOKE 自检
  ipc.ts                    # 主窗/设置窗 IPC 处理器
  services/                 # license / updater / crash / hotkey / tray / autostart
  providers/                # searchEngine(纯函数评分) / apps(三端应用扫描) / commands
  plugins/                  # manager(扫描/seed/热重载) / host(沙箱视图+协议) / staging(.bkx)
  windows/                  # 主搜索窗(无框毛玻璃) / 设置窗
apps/desktop/src/preload/   # main.ts(主窗桥) / plugin.ts(沙箱桥)
apps/desktop/src/renderer/  # search(搜索面板) / settings(设置) — React+Vite
packages/shared/            # IPC 通道 / 清单 zod schema / 权限枚举 / License 验签
packages/sdk/               # 插件作者用的 bk API 类型
packages/plugin-template/   # 插件模板
plugins/                    # 插件源码（随包 seed 到用户目录；也是市场的发布源）
market/                     # 静态插件市场（index.html 入库；生成物 CI 重建）→ GitHub Pages
tools/                      # license-cli / update-server / build-market / gen-icons
```

## License

见 [LICENSE](LICENSE)。
