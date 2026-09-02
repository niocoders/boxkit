# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 约定，版本遵循语义化版本规则。

## [Unreleased]

### Added

- MIT 开源治理文件、第三方许可清单和发布 provenance 记录。
- GitHub Actions 的冻结依赖安装、最小权限、产物校验和静态治理审计。
- GitHub Releases 作为正式更新发布渠道的文档与构建配置。

### Changed

- 主仓文档同步当前插件独立化架构与兼容边界。
- 删除过期授权 CLI、旧密钥例外、本机凭据路径和商业专有授权描述。

## [1.0.0] - 2026-08-30

### Added

- 跨平台 Electron 启动器、托盘常驻、全局快捷键和应用/系统命令搜索。
- 插件清单校验、安装暂存、权限确认、开发目录热重载和兼容 API 适配层。
- `.bkx`、`.zip`、`.upx` 插件包导入，以及静态市场清单消费和 SHA-256 校验。
- macOS、Windows 和 Linux 的 electron-builder 打包目标及 GitHub Actions 验证流程。
- 可选崩溃上报、本地日志、自动更新和本地更新 feed 联调能力。

[Unreleased]: https://github.com/niocoders/boxkit/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/niocoders/boxkit/releases/tag/v1.0.0
