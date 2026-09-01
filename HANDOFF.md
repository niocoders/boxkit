# BoxKit 交接文档（换机继续开发必读）

> 更新时间：2026-08-31（第四次更新：**后台移除 → 纯客户端 + GitHub Pages 静态插件市场**）
> 项目路径：`boxkit/`（pnpm monorepo，**纯客户端项目，无自建服务端**）
> 现状：**客户端已对标 uTools**（固定面板/高亮/频率排序/最近使用/副命令/快捷键录制/插件市场），**插件市场为 GitHub Pages 静态市场**（plugins/ 源码 → CI 打包 .bkx + manifest → Pages 门户 + 客户端消费），**GitHub CI 三端已打通**（私有仓 niocoders/boxkit）。

---

## 〇、2026-08-31 市场静态化（本节最新）

**决策：干掉 Spring Boot 后台（原 `server/` 已整体删除，连同误提交的 target 产物），市场改为「插件放 GitHub 仓库 + Pages 静态站点」的纯客户端架构。**

| 事项 | 结果 |
|---|---|
| 删除 `server/`（SpringBoot 2.7 + MP + Sa-Token + MySQL 全部，含 static 双 Web 端与 storage .bkx）；结束本机残留的 2 个 market-server java 进程 | ✅ |
| 新增 `tools/build-market.mjs`（零依赖）：扫描 `plugins/*` → uTools 清单归一化校验 → **纯 Node 打包 stored zip**（.bkx，含 UTF-8 flag/CRC32/central directory）→ 复制 logo → 生成 `market/manifest.json`（fileUrl/logoUrl 相对路径 + fileSize + **sha256** + keywords 汇总）；`pnpm market` | ✅ Expand-Archive 与 unzip 双端解压验证 + 内容 diff 一致 |
| 新增 `market/index.html` 静态门户（原 server 用户端门户的继任）：fetch manifest.json 本地搜索、卡片浏览、「导入到 BoxKit」（boxkit-market:// 协议）、「下载 .bkx」 | ✅ |
| 客户端 `services/market.ts` 重写：数据源 = `${marketUrl}/manifest.json`（默认 `https://niocoders.github.io/boxkit-market`），keyword 客户端本地过滤，相对路径转绝对 URL，**下载后 sha256 校验**再走 stageInstall；shared MarketPlugin 类型清理（删 downloads/filePath/latestVersion，加 sha256/keywords）；设置卡片「N 次安装」改为「包大小」 | ✅ typecheck 干净 22/22 测试通过 |
| 新增 `.github/workflows/pages.yml`：push（plugins/**, market/**, tools/build-market.mjs）或手动触发 → build-market.mjs → deploy-pages 部署 `market/`；生成物（manifest.json/plugins/logo）已 gitignore，**门户 index.html 入库** | ✅ 需仓库 Settings → Pages → Source 选「GitHub Actions」启用 |
| 端到端模拟验证（本地 http 托管 market/）：清单加载 → 关键字搜索 → 下载比对大小/zip 头/sha256 → 门户协议按钮，全通过 | ✅ |

**架构链路**：`plugins/` 源码（入库）→ push → CI `pages.yml` 打包部署 → GitHub Pages（门户 + manifest.json + .bkx）→ 用户浏览器门户（一键导入/下载）+ 客户端市场页（拉清单/sha256 校验/安装确认）。

**注意**：私有仓需 GitHub Pro 才能开 Pages；不想公开市场时把客户端「市场地址」指向任意静态托管即可（设置可改，本地联调 `pnpm market` + `npx serve market`）。

**新踩坑（接上轮编号）**：

28. **server/target 曾被误提交进 git**（.gitignore 加晚了）；删除时 jar 被本机 java 进程占用 `rm` 报 Device busy → 先 `taskkill` market-server 进程再删。
29. **纯 Node 打 stored zip 要点**：local header flags 置 0x0800（UTF-8 文件名）、method 0、CRC32 自实现（标准表）；PowerShell Expand-Archive / unzip / ditto 均可解。无需目录条目（包根直接放文件，客户端 staging 支持根或唯一子目录两种布局）。
30. 静态市场相对路径设计：manifest 里的 fileUrl/logoUrl 是**相对清单的路径**，客户端统一 `new URL(rel, base + "/")` 转绝对 —— 换市场地址零成本。
31. manifest 是「清单内容寻址」（含 sha256），改插件必须 bump version 才会产出新 .bkx 文件名，否则同文件名覆盖但 Pages CDN 可能有缓存（门户 fetch 已带 no-cache）。

## 〇.1、2026-08-30 uTools 对标进展

| 事项 | 结果 |
|---|---|
| 面板 UX 对标 uTools：固定 760×600 不可拉伸、关键字高亮（mark 蓝）、使用频率加权排序、空输入「最近使用」（usage.json 持久化）、副命令展开（`→` 展开插件全部关键字，`←`/Esc 收起） | ✅ 冒烟 `ok:true apps:84`，测试 28/28 |
| 快捷键录制控件（设置→通用）：点击录制→按下组合键→自动保存；globalShortcut 注册失败返回冲突提示（`configSet` 返回 `ConfigSetResult{settings, hotkeyError}`） | ✅ |
| 插件市场客户端：设置→插件→「已安装/插件市场」分段切换；市场卡片（logo/作者/版本比对「可更新」）；安装走下载→暂存→权限确认复用链路；`marketFetch`/`marketInstall` IPC；市场地址可在设置修改（2026-08-31 起默认为 GitHub Pages 静态市场） | ✅ |
| ~~市场后台 `server/`~~（**2026-08-31 已删除**，由 GitHub Pages 静态市场替代，见〇节） | — |
| GitHub CI 三端：私有仓 `niocoders/boxkit`（设备码授权流程打通，token 在 `D:/workspace/boxkit/.gh-token`）；`ci.yml` 三端（typecheck/test/build/smoke）**全绿（Linux 真机冒烟通过 → C2 .desktop 解析已验证）**；`release.yml` 触发 v1.0.0 → **success，11 个资产全部产出并下载到 `D:/workspace/boxkit/ci-artifacts/` 验收通过**（arm64/x64 dmg、arm64/x64 mac.zip、AppImage、deb、NSIS exe、win zip、latest*.yml×3；dmg/ELF/deb/PE/zip 魔数与清单 sha512/size 均核对） | ✅ 三端打包闭环 |

**新踩坑（接上轮编号）**：

20. **Windows 命令行传 JSON 给 curl.exe 会吞引号**（Node execFileSync 也一样）→ GitHub API 400 "Problems parsing JSON"。解法：`--data-binary @file` 临时文件传 body。
21. **GitHub 设备码授权流程**：client_id 用 GitHub CLI 公开的 `178c6fc778ccc68e1d6a`，scope `repo workflow`；本机访问 GitHub 必须走用户代理 `127.0.0.1:7897`（curl/git 都要；git 走 `HTTPS_PROXY` 环境变量即可）。
22. `mvn` 用户全局 settings.xml 是阿里云**旧地址**（缺新包）→ 项目级 `.mvn/settings.xml` 用新地址 `https://maven.aliyun.com/repository/public`，`mvn -s` 指定，不动全局。
23. sa-token 1.37.3 阿里云还没同步 → 用 1.39.0（API 兼容）。Java 11 不支持 record；MyBatis-Plus LambdaQueryWrapper 需要 getter（实体要手写 accessors）。
24. H2 兼容 MySQL 模式跑 schema 注意：`user` 是 H2 保留字（表已改名 `market_user`）；`spring.sql.init.encoding: utf-8` 必须配，否则中文 Windows（GBK）下 data.sql 乱码。
25. electron-builder Linux target 要求 package.json 有 `homepage`，否则 CI 报 "Please specify project homepage"。
26. `pnpm/action-setup@v4` 的 `version` 入参与 package.json `packageManager` 同时存在会报 "Multiple versions of pnpm" → 删 workflow 里的 version。
27. **Windows CWD 陷阱**：Git Bash 的 CWD 会跨命令保持，`git rm --cached`/`.gitignore` 重定向很容易写错目录；提交前务必 `git ls-tree -r HEAD` 验证没有把 `server/target` 之类带进去。

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
plugins/                    # 插件源码（随包 seed 到用户目录；也是市场的发布源，push 即发布）
market/                     # 静态插件市场：index.html 门户（入库）+ CI 生成物（manifest/plugins/logo，gitignore）
tools/                      # license-cli / update-server / build-market.mjs / gen-icons.mjs
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


## 附：实机对照工具与结论（2026-08-30 深夜）

- **PrintWindow 通道已打通**：对 uTools 窗口 `PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT=2)` 可完整抓取其实机渲染（含后台窗口），抓图存 `C:/Users/xuzilong/AppData/Local/Temp/ut-*.png`。已抓到管理中心/插件市场页实机图——布局与 BoxKit 市场页同构（搜索+卡片网格+排行榜）。
- **uTools 主面板视图无法注入到达**：热键（Alt+Space）对注入无响应；`utools://panel` 协议语义是"搜索插件 panel"（会弹「未发现插件应用」页）；键盘/鼠标注入被会话吞掉。主面板只能由真人在活跃会话按热键唤出。
- **面板对照已完成**：以官方 utools-main.png 为基准逐项对齐（离屏截图 `BOXKIT_PANEL_SHOT` 可随时复验），剩余仅为实机同屏最终确认。
- **区域截屏运行时实测**：`BOXKIT_SHOT_TEST` 断开会话下 `BitBlt 0x5`（Windows 会话隔离硬限制），会话恢复重跑即出 `SHOT_TEST_OK full=2560x1440 crop=200x100`。
