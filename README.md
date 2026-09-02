# BoxKit

BoxKit 是一个基于 Electron、React 和 TypeScript 的跨平台效率启动器与插件平台。它提供全局快捷键搜索面板、应用与系统命令、文件搜索、受控剪贴板历史、插件运行时、静态插件市场和 GitHub Releases 更新。

## 主要能力

- 无框搜索面板：键盘导航、最近使用、收藏、模糊匹配、首字母匹配和网络搜索兜底
- 跨平台应用发现：macOS 应用、Windows 开始菜单快捷方式、Linux desktop entries
- 本地文件搜索：仅扫描常用用户目录，限制深度、数量和扩展名
- 剪贴板历史：默认关闭；启用后仅保存受限大小的非敏感文本、图片或文件路径
- 插件管理：本地包、开发目录、启停、升级、卸载和权限确认
- 静态市场：客户端读取公开 registry，强制校验 SHA-256 后进入安装确认
- 桌面集成：托盘、开机自启、全局快捷键、协议导入和多平台安装包
- 隔离的插件数据：每个插件拥有独立的 KV/文档存储和会话分区

## 安全边界

插件兼容视图为已有生态提供 Node/preload 运行模式，因此安装插件等同于信任其代码。权限确认约束宿主提供的 API，但不能阻止插件自身使用 Node 或直接访问网络。请只安装你信任来源的插件，并在发布插件时声明维护者、许可证和来源。

市场下载默认要求 HTTPS；`localhost`、`127.0.0.1` 和 `::1` 仅用于本地开发。每个市场条目必须携带 64 位 SHA-256 摘要，客户端会在解压和身份校验前验证摘要。

兼容适配层支持部分既有插件清单和全局 API。它是独立实现，不代表任何第三方产品的官方实现、替代品或发行版。法律归属见 [NOTICE](NOTICE)。

## 开发环境

要求 Node.js 20 或更高版本、pnpm 10 或更高版本。

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm ui:smoke
```

本地运行：

```bash
pnpm dev
```

运行 Electron 初始化 smoke：

```bash
cd apps/desktop
BOXKIT_SMOKE=1 npx electron . --no-sandbox
```

## 发布

桌面包由 `.github/workflows/release.yml` 在推送 `v*` 标签后构建并上传到 GitHub Releases。当前工作流生成 Windows NSIS/zip、macOS dmg/zip 和 Linux AppImage/deb/tar.gz。代码签名与 macOS 公证需要在仓库 Secrets 中配置证书和凭据。

默认更新 feed 使用 GitHub Releases；本地更新服务器只能通过设置页或 `BOXKIT_UPDATE_URL` 显式配置。

插件源码、市场 registry、`.bkx` 构建产物和开发模板位于独立的公开市场仓库：

<https://github.com/niocoders/boxkit-market>

主程序只在运行时安装插件，不把插件源码作为桌面包资源内置。市场仓库是否已公开、是否具备 MIT 许可证以及 Pages 产物是否可追溯，需要在该仓库中单独验收。

## 项目结构

```text
apps/desktop/src/main/       Electron 主进程、窗口、服务、provider 和插件宿主
apps/desktop/src/preload/    主窗口与插件兼容桥
apps/desktop/src/renderer/   搜索面板与设置页
packages/shared/             IPC、类型和 plugin.json 校验
packages/sdk/                插件作者使用的类型定义
tools/                       图标生成、更新服务器示例和治理检查
```

## 测试

当前测试覆盖搜索评分、结果排序、清单归一化、路径安全、剪贴板过滤、暂存标识和市场摘要。`pnpm ui:smoke` 会启动真实 Electron 并通过 Playwright CDP 验证搜索输入、键盘导航、首次市场跳转、市场卡片、已安装空态和设置开关；截图与报告写入 `artifacts/electron-ui/`。

## 许可证

本项目采用 MIT 许可证，详见 [LICENSE](LICENSE)。第三方依赖与兼容名称说明见 [NOTICE](NOTICE) 和 [docs/third-party-licenses.md](docs/third-party-licenses.md)。

## 贡献与安全

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [SECURITY.md](SECURITY.md)。安全问题不要公开提交可利用细节。
