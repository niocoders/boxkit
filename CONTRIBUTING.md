# Contributing to BoxKit

感谢参与 BoxKit。主仓库维护跨平台桌面客户端、插件安装器、兼容运行时和客户端市场页；插件源码、市场门户和市场构建流水线属于独立的外部仓库，不在本工作区内。

## 开始开发

要求：Node.js 20 或更高版本，以及 pnpm 10 或更高版本。仓库通过 `packageManager` 字段固定 pnpm 版本。

```bash
pnpm install --frozen-lockfile
pnpm audit:governance
pnpm typecheck
pnpm test
pnpm build
```

开发客户端：

```bash
pnpm dev
```

桌面构建产物写入 `apps/desktop/release/`。跨平台发布应使用 GitHub Actions；Windows 可本地构建 Windows 目标，macOS 和 Linux 目标请使用对应平台或发布 workflow。

## 提交变更

1. 从 `main` 创建短期分支，并让每个提交保持单一目的。
2. 业务行为变更补充或更新测试；文档、包元数据和 workflow 变更说明可复现的验证命令。
3. 不要提交 `node_modules/`、构建产物、私钥、访问令牌、崩溃日志或用户数据。凭据只能通过本地环境或 GitHub Secrets 注入。
4. pull request 应说明影响的平台、兼容性边界、测试结果和任何外部发布阻塞项。
5. 只有在确认所有依赖、代码和文档可按 MIT 及相关第三方许可分发后，才提交新的可分发内容。

## 插件与市场

主仓不包含插件源码或市场生成物。当前工作区没有 `boxkit-market` 仓库，因此不会在此仓库伪造或代改市场仓文件。需要发布插件时，应在市场仓单独完成插件维护者、来源、许可证、构建摘要和 Pages 发布信息，再在客户端中使用其静态地址验证。

插件运行时为兼容既有生态而保留 Node 集成能力，这不是安全沙箱；安装插件等同于信任插件代码。涉及安装器、清单、URL、权限、归档路径或窗口消息的变更，必须在 pull request 中明确威胁模型和失败清理行为。

## Pull request 检查

CI 会在三端运行类型检查、测试、构建和 smoke 检查。提交前至少运行：

```bash
pnpm audit:governance
pnpm typecheck && pnpm test
pnpm build
```

发布相关变更还应确认：

- workflow 使用 `pnpm install --frozen-lockfile`；
- action 引用至少固定到 major，并在 workflow 注释中记录 SHA pinning 的当前限制；
- 产物带有 SHA-256 校验清单和 provenance JSON；
- GitHub Release 是正式更新渠道，本地 feed 只能显式配置用于联调；
- `LICENSE`、`NOTICE` 和第三方许可清单与变更保持同步。

## 行为准则

参与项目即表示同意遵守 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)。安全问题请遵循 [`SECURITY.md`](SECURITY.md)，不要在公开 issue 中发布可利用细节或凭据。
