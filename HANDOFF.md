# BoxKit 交接说明

更新时间：2026-09-02

## 当前状态

BoxKit 是一个 pnpm monorepo，包含 Electron 桌面应用、共享协议和插件 SDK。主程序不内置插件源码；插件源码、市场 registry、发行包和模板维护在独立的公开市场仓库。

当前已完成：

- 跨平台桌面启动器、托盘、单实例和全局快捷键
- 应用扫描、系统命令、文件搜索和网络搜索兜底
- 最近使用、使用频率、收藏、模糊/首字母匹配
- 可选剪贴板历史，默认关闭并过滤常见敏感内容
- 本地插件包安装、开发目录、启停、升级、卸载和暂存确认
- 静态市场下载、强制 SHA-256 校验、包身份/版本校验和协议导入
- 插件会话、KV/文档存储、窗口、通知、剪贴板、屏幕和外部链接适配
- GitHub Actions 三平台 CI 与 GitHub Releases 发布工作流
- MIT 许可证、NOTICE、贡献指南和安全报告流程

## 可信边界

兼容视图为了支持既有插件而启用 Node/preload 能力，并关闭上下文隔离。安装插件相当于运行本地代码；manifest 权限只限制宿主 API，不构成 Node 沙箱。发布或安装插件前必须检查来源、维护者、许可证和包摘要。

兼容适配层只实现已列出的生命周期、子输入、数据存储、剪贴板、窗口、通知、显示器、对话框、截图和外部链接能力。账号体系、云端同步、浏览器自动化和第三方私有后端不应被描述为已实现。

## 开发命令

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm dev
```

Electron smoke：

```bash
cd apps/desktop
BOXKIT_SMOKE=1 npx electron . --no-sandbox
```

## 关键路径

```text
apps/desktop/src/main/index.ts             生命周期和 smoke
apps/desktop/src/main/ipc.ts               主窗口/设置窗口 IPC
apps/desktop/src/main/providers/            应用、文件、搜索、收藏、剪贴板
apps/desktop/src/main/plugins/              管理、暂存、兼容宿主
apps/desktop/src/main/services/             市场、更新、托盘、日志
apps/desktop/src/preload/                   主窗口和插件桥
apps/desktop/src/renderer/                  搜索面板和设置页
packages/shared/src/                       IPC、类型、manifest schema
packages/sdk/src/                           插件类型定义
tools/                                      图标与本地更新服务示例
```

## 发布注意事项

- 默认更新 feed 指向 GitHub Releases；本地更新源必须显式设置。
- 市场条目必须有 64 位 SHA-256，市场仓构建应保留源码 commit 与构建报告。
- macOS 公证和 Windows 代码签名依赖外部证书 Secrets，未配置时只能发布未签名包。
- 祖先提交曾存在开发密钥和旧构建产物。公开仓库前应轮换相关凭据；如需清理 Git 历史，必须由仓库管理员单独审批并执行 force-push。
- 当前市场仓不在本工作区。市场仓的公开性、MIT LICENSE、插件许可证和 Pages 产物可追溯性必须在那里单独验收。

## 已知测试边界

当前测试覆盖搜索和清单校验。插件宿主 IPC、真实 Electron renderer、市场网络和跨平台打包仍应持续增加集成测试。`BOXKIT_SMOKE` 只证明初始化和降级路径，不代表完整 UI 验收。
