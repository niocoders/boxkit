# BoxKit 交接文档（换机继续开发必读）

> 更新时间：2026-08-29（第二次更新：Windows 机器完成三端打包收尾）
> 项目路径：`boxkit/`（pnpm monorepo）
> 现状：**macOS MVP 已跑通**；**Windows 机器上完成 C1/C2 多端适配 + Windows 打包全链路验证 + 更新端到端验证**；Linux 产物与 macOS 产物需 CI（流水线已配置好）。

---

## 〇、2026-08-29 换机后进展（本节新增）

| 事项 | 结果 |
|---|---|
| Windows 适配 C1：开始菜单 `.lnk` 扫描（PowerShell 批量解析，84 个应用）、Win 系统命令 5 条、`.bkx` 双击安装（second-instance argv + 冷启动 argv 链路） | ✅ 冒烟 `ok:true, apps:84` |
| Linux 适配 C2：XDG `.desktop` 解析（含 Flatpak 目录、zh 本地化名、hicolor/pixmaps 图标）、Linux 命令 3 条 | ✅ 代码就绪（真机行为待 CI/Linux 环境验证） |
| Windows 打包 A1/A2：NSIS + zip + latest.yml 全部产出 | ✅ `apps/desktop/release/` |
| Linux 打包 A1/A2：AppImage 在 Windows 主机不可构建（electron-builder 平台限制，实测缺 mksquashfs）；`tar.gz` 兜底包本机产出并验证 | ✅ 部分本机 + CI 补全 |
| 打包产物回归 A3：打包后 BoxKit.exe 冒烟（托盘图标/插件/icon.png 均在 resources 内） | ✅ `BOXKIT_SMOKE_OK ok:true apps:84` |
| 更新端到端 A4：本地更新服务器 + 打包应用静默检查 → 发现 1.1.0 → 全量下载 → 落盘 pending | ✅ 全链路打通 |
| E1 文档：README.md + docs/plugin-dev.md（含权限表、API 速览、.bkx 打包） | ✅ |
| E3 CI：`.github/workflows/ci.yml`（三端 typecheck/test/build/smoke）+ `release.yml`（tag 触发三端构建发布） | ✅ 待 push 后跑通首次流水线 |
| E4 git init + 首次提交 | ✅ |
| B4 隐私声明 | ✅ README「隐私声明」节 |
| macOS 产物 A5 | ⏳ 需 macOS/CI（release.yml 已就绪），签名公证需 Apple 账号 |

**新踩坑（重要）**：

12. **electron-builder 下载 electron zip 走 GitHub 直连会 10 分钟超时**：`.npmrc` 已写 `electron_mirror` 与 `electron_builder_binaries_mirror`，且 `electron-builder.yml` 加了 `electronDownload.mirror`。打包时仍建议导出 `ELECTRON_MIRROR` 环境变量（pnpm 的构建脚本不继承 shell 环境变量，失败时手动 `node node_modules/electron/install.js`）。
13. **没有 `publish` 配置就不生成 latest.yml**（electron-builder 26）：已在 yml 加 `publish: {provider: generic, url: …}`，只生成清单不上传。
14. `linux.desktop` 配置项已废除（26 版校验直接报错）；Linux 可执行名需显式 `linux.executableName: BoxKit`（包名 `@boxkit/desktop` 的 `@` 非法），package.json 补 `desktopName`。
15. **托盘图标曾经打不进包**：`extraResources` 原来只拷了 plugins；已补 `from: resources, to: .`（trayTemplate/icon.png 进 resources 根目录）。非 mac 平台托盘用彩色 `icon.png`（黑色模板图标在任务栏不可见）。
16. 打包后的 Windows GUI 程序冒烟：用 `BoxKit.exe --enable-logging BOXKIT_SMOKE=1` 可在终端看到 `BOXKIT_SMOKE_OK` 输出。
17. `compression: maximum` 下 NSIS/zip 单平台构建约 15 分钟，耐心等。
18. **AppImage/deb 无法在 Windows 主机构建**（实测报错 `spawn ...\darwin\mksquashfs ENOENT`）；`tar.gz` 目标走 app-builder 归档器，Windows 可直接构建，已加入 linux targets 作为兜底。Linux/macOS 产物统一走 `release.yml` CI。
19. pnpm hoisted 布局下 `apps/desktop/node_modules/electron` 可能出现一份**没有 dist 的副本**（electron-builder 运行后出现），`npx electron` 会因此卡在重新下载二进制。修复：`cd apps/desktop/node_modules/electron && ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node install.js`。

---

## 一、当前完成度（已验证 ✅）

| 模块 | 状态 | 验证方式 |
|---|---|---|
| monorepo 骨架（pnpm + TS + vitest） | ✅ | `pnpm typecheck` 零错误 |
| 共享协议 `packages/shared`（IPC 通道 / plugin.json zod schema / 权限枚举 / License 验签核心） | ✅ | 单测通过 |
| 插件 SDK 类型 `packages/sdk`（`window.bk` 全量类型） | ✅ | 编译通过 |
| 主进程（单实例 / 托盘 / 全局快捷键 / 配置存储 / 日志） | ✅ | 冒烟 + 实际运行 |
| 搜索系统（macOS 应用扫描 75 个、系统命令、评分排序、网络搜索兜底） | ✅ | 单测 + 实际运行 |
| 插件系统（清单校验 / .bkx 安装暂存 / 权限确认弹窗 / 沙箱 WebContentsView / `bk-plugin://` 协议 / 开发目录热重载 / 官方插件 seed） | ✅ | 实际运行中插件打开→退出成功 |
| 官方插件 ×2（剪贴板历史、DevToolbox 时间戳/JSON/UUID，含子输入框接管演示） | ✅ | 已随包 seed 并运行 |
| 插件模板 `packages/plugin-template` | ✅ | 文件就绪 |
| 授权系统（Ed25519 离线验签 / 试用期 14 天 / 设备绑定 / safeStorage 存储 / 设置页激活 UI） | ✅ | 25 个单测含 **CLI 签发↔客户端验签互操作** |
| License CLI（`tools/license-cli`，零依赖：keygen/issue/verify/show） | ✅ | 单测调用验证 |
| 自动更新（electron-updater 接线 + 本地更新服务器示例 `tools/update-server`） | ⚠️ 代码就绪，**端到端未测** | — |
| 崩溃上报（Sentry 主进程接入 + 本地 crash 日志兜底，设置页开关） | ⚠️ 代码就绪，无 DSN 未实测 | 启动日志确认降级逻辑正确 |
| 应用图标 / 托盘模板图标（纯 Node PNG 编码器生成） | ✅ | 文件已生成 |
| 沙箱 preload（5KB，白名单 API，无 Node 内建依赖） | ✅ | 构建产物确认 |

**测试基线：`pnpm test` → 25/25 通过；`pnpm typecheck` → 干净；`BOXKIT_SMOKE=1` 冒烟输出：**
```json
{"ok":true,"apps":75,"plugins":["clipboard-history","devtoolbox"],"license":"trial","mainWindow":true,"hotkey":"Option+Space","platform":"darwin/arm64","version":"1.0.0"}
```

---

## 二、新机器环境准备

1. **Node ≥ 20**（用到内置 crypto、`fs.cpSync`）、**pnpm ≥ 10**（`pnpm -v` 检查）
2. 克隆/拷贝整个 `boxkit/` 目录后，根目录执行：
   ```bash
   pnpm install
   ```
   ⚠️ **Electron 二进制下载大概率要走镜像**（本机 GitHub 直连失败过一次，npmmirror 成功）：
   ```bash
   ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node node_modules/electron/install.js
   ```
3. 常用命令（均在仓库根目录）：
   ```bash
   pnpm typecheck   # TS 类型检查
   pnpm test        # vitest 25 用例
   pnpm build       # esbuild(main/preload) + vite(渲染层) → apps/desktop/dist
   pnpm dev         # 开发模式（vite HMR + esbuild watch + electron）
   pnpm icons       # 重新生成图标（一般不需要）
   pnpm license ... # 授权 CLI
   # 冒烟自检（CI 友好，自动退出）：
   cd apps/desktop && BOXKIT_SMOKE=1 npx electron . --no-sandbox
   ```

---

## 三、未完成工作（按优先级）

### A. 打包收尾
- [x] **A1 打包验证**：✅ 2026-08-29 Windows 完成（NSIS+zip+latest.yml）；mac 见 release.yml 流水线
- [x] **A2 完整分发**：✅ Windows 侧完成；mac dmg+zip、linux AppImage+deb 由 CI 产出
- [x] **A3 打包产物回归（Windows）**：✅ 打包后冒烟 ok:true apps:84；`.bkx` 双击安装链路已接通（argv），真实双击体验待装机抽查
- [x] **A4 更新端到端**：✅ 本地更新服务器 + 打包应用验证全链路（发现→下载→落盘）；正式环境换真实服务器即可
- [ ] **A5 签名与公证**（需 Apple Developer 账号 $99/年 + Windows 代码签名证书）：CI 已预留 Secrets（`APPLE_ID` 等），把 `electron-builder.yml` 的 `notarize` 改 `true`；Windows 配 `certificateFile/certificatePassword`

### B. 商用安全【高】
- [ ] **B1 生产密钥对替换**（当前内置的是开发密钥）：
  ```bash
  pnpm license keygen --out <离线保管目录>
  # 把生成的 public.pem 内容替换 apps/desktop/src/main/services/license.ts 中
  # BOXKIT_LICENSE_PUBLIC_KEY，重新构建；私钥离线保管，绝不入库
  ```
- [ ] **B2 试用期防篡改评估**：`.sys-meta` 试用期标记是轻混淆（HMAC 截断），懂技术的用户可删除重置。商用前决定是否升级为服务端激活（需要后端）。
- [ ] **B3 Sentry 上线**：注册 Sentry → 拿 DSN → 打包环境注入 `BOXKIT_SENTRY_DSN`。可选增强：渲染进程接 `@sentry/electron/renderer`（目前仅主进程 + 渲染进程崩溃本地日志）。
- [x] **B4 隐私合规**：✅ README「隐私声明」节已写；首次启动试用期 toast 已有；上报开关在设置页。

### C. 多端适配
- [x] **C1 Windows**：✅ 开始菜单扫描 / 系统命令 / `.bkx` 关联完成；签名证书配好前出未签名包
- [x] **C2 Linux**：✅ `.desktop` 解析 + AppImage/deb 配置完成；真机回归交给 CI smoke
- [x] **C3 三端回归**：✅ 冒烟三端进 CI（ci.yml，Linux 走 xvfb）；快捷键/ vibrancy 已平台化

### D. 产品功能【中】（全部未动，按价值排序）
- [ ] D1 拼音/首字母匹配（`searchEngine.ts` 的 `matchScore` 是纯函数，加一层拼音索引即可）
- [ ] D2 使用频率排序 / 搜索历史
- [ ] D3 插件市场（服务端清单聚合 + 客户端市场页；安装链路 `stageInstall/commitInstall` 可直接复用）
- [ ] D4 文件搜索 provider（macOS 用 `mdfind`，Win 用 everything SDK 或索引 API）
- [ ] D5 剪贴板全局监听（当前剪贴板插件仅在打开时轮询；uTools 是后台常驻监听 → 主进程轮询 + 推送）
- [ ] D6 子输入框结果回填主列表（uTools 式协议；当前仅把输入转发给插件）
- [ ] D7 快捷键录制控件（当前手输 accelerator 字符串）
- [ ] D8 i18n（当前中文写死）

### E. 工程化
- [x] **E1** ✅ README.md + docs/plugin-dev.md 完成
- [ ] E2 ESLint + Prettier（当前仅 tsc strict）
- [x] **E3** ✅ .github/workflows/ci.yml（三端验证）+ release.yml（三端发布）
- [x] **E4** ✅ git init + 首次提交（2026-08-29）
- [ ] E5 生产环境考虑主包压缩（当前 3.4MB 未 minify，构建脚本把 `minify: false` 打开即可）

---

## 四、关键文件地图

```
apps/desktop/src/main/
  index.ts                  # 入口：生命周期总装 + BOXKIT_SMOKE 自检
  ipc.ts                    # 全部主窗/设置窗 IPC 处理器
  core/                     # paths / logger / config(设置存储)
  services/
    license.ts              # 授权状态机（内置公钥在文件顶部常量）
    updater.ts / crash.ts / hotkey.ts / tray.ts / autostart.ts / machine-id.ts
  providers/
    searchEngine.ts         # 纯函数搜索评分（有单测）
    apps.ts / commands.ts   # 应用扫描 / 系统命令（多端 TODO 标注在 case 分支）
  plugins/
    manager.ts              # 插件扫描/seed/热重载/插件 KV 存储
    host.ts                 # 沙箱视图 + bk-plugin:// 协议 + bk.* IPC 权限拦截
    staging.ts              # .bkx 解压/校验/暂存/提交
  windows/                  # 主搜索窗(无框毛玻璃) / 设置窗
apps/desktop/src/preload/   # main.ts(主窗桥) / plugin.ts(沙箱桥)
apps/desktop/src/renderer/  # search(搜索面板) / settings(设置) — React+Vite
packages/shared/src/        # ipc.ts(通道) / manifest.ts(清单校验) / license.ts(验签) / types.ts
packages/sdk/src/index.ts   # 插件作者用的 bk API 类型（文档素材）
plugins/                    # 官方插件（构建时打进包，首启 seed 到用户目录）
tools/                      # license-cli / update-server / gen-icons.mjs
```

---

## 五、踩坑记录（新机器必读）

1. **沙箱 preload 只能 import `@boxkit/shared/ipc`**（纯常量子路径），不能 import `@boxkit/shared` 主入口 —— 会连带打包 zod 和 `node:crypto`，沙箱 preload 禁止 Node 内建模块，运行即崩（曾经 700KB→5KB 就是这个原因）。
2. **electron-builder 要求 electron 版本固定**，已改 `"electron": "44.0.0"`，不要加回 `^`。
3. **Electron 二进制/electron-builder 辅助二进制下载走 npmmirror 镜像**（见第二节命令）。
4. **面板应用不进 Dock**：LSUIElement + `app.dock.hide()`，任务管理器/常规应用列表里找不到是正常的；用 Option+Space 或托盘唤起。自动化测试（AX/截屏）也看不见它，验证用 `BOXKIT_SMOKE=1`。
5. dev 模式下登录项设置被跳过（`app.isPackaged` 检查），启动日志有 "Unable to set login item" 属正常（打包后消失）。
6. **重置试用期**：删 `~/Library/Application Support/BoxKit/.sys-meta`。
7. 插件热重载：设置→插件→添加开发目录（含 plugin.json 的目录），保存后 400ms 防抖自动重载。
8. 修改主进程代码后 dev 模式需重启 electron（渲染层才有 HMR）。
9. userData 布局（mac）：`~/Library/Application Support/BoxKit/` → `config.json`、`plugins/`、`plugin-data/<插件>/db.json`、`logs/`、`license.dat`、`.sys-meta`。
10. 官方插件 seed 只在目录不存在时复制 —— 用户卸载后重启不会被重新装回来（符合预期）。
11. 本机（原机器）当前有一个终端后台起的 dev 实例还在运行，离开前可托盘退出或 `pkill -f "electron ."`。

---

## 六、快速验证清单（新机器装好后跑一遍）

```bash
pnpm install                                   # ① 依赖就位（必要时用镜像装 electron 二进制）
pnpm typecheck && pnpm test                    # ② 预期：0 错误 / 25 passed
pnpm build                                     # ③ 预期：dist/main + dist/preload(5KB级) + dist/renderer
cd apps/desktop && BOXKIT_SMOKE=1 npx electron . --no-sandbox
# ④ 预期输出 BOXKIT_SMOKE_OK {"ok":true,"apps":>0,"plugins":["clipboard-history","devtoolbox"],...}
npx electron-builder --dir                     # ⑤ A1 未完成项，从这里继续
```
