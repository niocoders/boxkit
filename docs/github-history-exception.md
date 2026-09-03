# GitHub 历史保留例外记录

**记录状态：** 已知并接受的历史保留例外
**记录日期：** 2026-09-02
**适用仓库：** 本仓库的公开 Git 数据
**审计范围：** `main`、`open-source/launcher-parity`、`v1.0.0`，以及与已合并 PR #1 关联的 `refs/pull/1/head`

## 摘要

已对 `main`、`open-source/launcher-parity` 和 `v1.0.0` 做过定向历史清理，并对相应公开分支或标签执行过 force-push/引用更新。清理目标是移除历史中的私钥和旧构建物；清理后复核确认当前公开树及上述路径历史不含私钥或旧构建物。

这项结论只适用于当前公开树和可复核的路径历史。它不声明 GitHub 或其他平台已经从所有内部缓存、备份、审计记录或平台管理引用中物理抹除旧对象。

## 已确认事实

1. **清理范围。** 定向历史清理覆盖 `main`、`open-source/launcher-parity` 和 `v1.0.0`，随后进行了 force-push/引用更新。清理不是对所有历史对象的无限范围保证；本记录只声明列出的公开引用和路径历史检查结果。
2. **当前公开内容。** 根据定向清理后的 GitHub 公开状态复核记录，当前公开树与路径历史不含私钥或旧构建物。检查包括当前引用指向的树、路径历史以及常见密钥和构建物文件后缀。该结论是公开平台状态的范围受限证明，不等同于当前工作区所有本地 refs 均已同步。
3. **平台保留引用。** 已合并 PR #1 的 `refs/pull/1/head` 是 GitHub 平台管理的只读 ref。尝试通过 API 对该 ref 执行 PATCH 或 DELETE 时，平台返回 HTTP 422，并报告：`refs/pull/* is read-only`。
4. **旧 blob 可读性。** 在该平台保留 ref 仍可达的对象范围内，旧 blob 仍可由该平台保留 ref 读取。只要该 ref 仍能解析到包含旧对象的提交，force-push 不能单独证明这些对象已从平台可达范围消失。
5. **本地复核注记。** 当前工作区的本地 `v1.0.0` ref 仍显示旧 `.bkx` 包，目标 refs 的本地路径历史也能显示旧 `.bkx` 路径；这与上述 GitHub 公开状态记录不一致，可能表示本地标签或镜像滞后，也可能表示远程状态仍需重新核对。由于远程查询受网络限制未完成，在 GitHub Support 确认前不得把这项本地差异标记为已解决。
6. **本地检查边界。** 本地 Git 检查只能说明当前克隆中可见的引用、路径历史和对象状态；它不能证明平台侧保留 ref、缓存、备份或镜像已清除。远程平台状态应以平台 API、网页和支持工单的最新结果为准。

## 风险评估

- **历史泄露风险：** 如果旧 blob 含有曾经暴露的私钥或凭据，任何仍可达的保留 ref 都可能使其继续被读取、镜像或索引。当前已知的保留 ref 可直接读取其仍可达的旧 blob。
- **不可逆性风险：** 即使删除或改写公开分支，第三方克隆、缓存、镜像、构建日志和下载副本也可能保留旧对象。
- **误用风险：** 依赖旧提交、旧路径或旧构建物的自动化流程可能在清理后失败，或重新引入不应使用的对象。
- **证据局限：** 当前树和路径历史“不含”目标内容，是范围受限的复核结论，不是对所有平台保留副本的否定。

风险等级：**高（凭据若曾真实有效则按已泄露处理）**。风险等级不会因公开分支已 force-push 而自动降低。

## 缓解与操作要求

1. 立即撤销任何曾出现在旧历史或旧构建物中的密钥、证书、令牌及相关会话，并按所属服务的流程轮换；不要等待平台侧删除结果。
2. 发布、部署和审计只依赖当前有效 refs 与当前树；不要依赖 `refs/pull/*`、旧提交、旧路径或旧构建物作为输入。
3. 不要复用旧密钥，即使它们目前看起来不可读、已从分支消失或尚未观察到滥用。
4. 检查 CI、发布系统、镜像、制品仓库、缓存、日志和本地克隆，确认没有从旧 ref 或旧对象恢复内容的任务。
5. 对外引用本记录时，必须同时说明平台保留 ref 的只读限制和旧 blob 仍可能可读这一残余风险。

## 复核命令

以下命令应在临时、干净的仓库副本中运行。命令不会修改引用；输出、日志和截图不得包含凭据或私人本机路径。

```sh
# 查看目标 refs 的当前指向
git rev-parse --verify refs/heads/main
git rev-parse --verify refs/heads/open-source/launcher-parity
git rev-parse --verify refs/tags/v1.0.0

# 检查目标 refs 当前树和路径历史中的密钥/旧构建物后缀
target_refs="refs/heads/main refs/heads/open-source/launcher-parity refs/tags/v1.0.0"
git grep -n -I -E 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|(^|[^[:alnum:]])(api[_-]?key|access[_-]?token|password|secret)[[:space:]]*[:=]' $(git rev-list $target_refs) -- . ':!node_modules' || true
git log $target_refs --name-only --format= -- \
  '*.pem' '*.key' '*.p12' '*.pfx' '*.cer' '*.crt' \
  '*.dmg' '*.pkg' '*.msi' '*.exe' '*.zip' '*.tar.gz' \
  '*.AppImage' '*.deb' '*.blockmap'

# 检查当前克隆中是否存在不可达对象
git fsck --full --no-reflogs --unreachable --no-progress

# 在网络可用时核对远程公开 refs；该查询不执行写操作
git ls-remote origin refs/heads/main refs/tags/v1.0.0 'refs/pull/1/head'
```

第一条 `git grep` 可能因仓库没有提交或 Git 版本差异而需要人工确认；`|| true` 只避免“没有匹配”使复核脚本中断，不应隐藏命令错误。对路径后缀命令的非空输出应逐项核查，不应自动视为凭据泄露。

## 后续 GitHub Support 请求

请通过 GitHub Support 提交私密请求，要求平台核查并在其能力范围内清理或限制以下对象：已合并 PR #1 的 `refs/pull/1/head` 所能到达的旧提交和旧 blob，以及相关缓存、索引和备份保留周期。请求中应说明：

- 目标仓库和受影响 ref：`refs/pull/1/head`；
- 该 ref 为平台管理的只读 ref；
- 对该 ref 的 API PATCH/DELETE 返回 HTTP 422：`refs/pull/* is read-only`；
- 相关分支和标签已经定向历史清理并 force-push/更新；
- 当前公开树与路径历史已完成复核，但旧 blob 仍可能由保留 ref 读取；
- 已完成凭据撤销与轮换，并请求平台确认可执行的清理、缓存失效和保留范围；
- 不要在工单中粘贴真实密钥、令牌、完整旧 blob 或私人本机路径；如需定位对象，仅提供提交 ID、blob ID 或其他非敏感标识。

平台回复应保存为私密审计记录，并记录请求编号、提交时间、处理范围、平台确认的限制以及下一次复核日期。除非平台明确确认清理完成，否则本记录中的历史保留例外继续有效。

## 结论

公开分支和标签的定向清理已完成，当前树与路径历史通过复核；但平台管理的 `refs/pull/1/head` 无法通过普通 API PATCH/DELETE 删除，且其可达旧 blob 仍构成残余暴露面。凭据按已泄露处理，平台保留 ref 作为例外持续跟踪，直到 GitHub Support 对对象可达性和保留范围给出明确结论。
