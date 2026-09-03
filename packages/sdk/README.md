# @boxkit/sdk

BoxKit 插件开发 SDK，提供 `window.bk` 的 TypeScript 契约、legacy 兼容 API 类型，以及运行环境检测辅助函数。

## 安装与导入

```bash
pnpm add @boxkit/sdk
```

ESM：

```ts
import { HOST_API_VERSION, getBK, inBoxKit } from "@boxkit/sdk";
import type { InputPayload, PluginEnterArgs } from "@boxkit/sdk";

const bk = getBK();
bk.onPluginEnter((args: PluginEnterArgs) => {
  console.log(args.code, args.payload);
});
```

CommonJS：

```js
const { getBK, HOST_API_VERSION } = require("@boxkit/sdk");
```

SDK 是类型和轻量辅助包，不会在 import 时访问 Electron、Node 或宿主对象。只有调用 `getBK()` 才会检查当前页面是否由 BoxKit 插件宿主提供 `window.bk`。

## 最小插件

插件包至少包含以下文件：

```text
my-plugin/
  plugin.json
  index.html
```

```json
{
  "name": "hello-boxkit",
  "displayName": "Hello BoxKit",
  "version": "1.0.0",
  "main": "index.html",
  "features": [
    { "code": "hello", "explain": "Say hello", "cmds": ["hello"] }
  ],
  "permissions": []
}
```

`index.html` 中的脚本可以使用 `window.bk`，例如：

```ts
import { getBK } from "@boxkit/sdk";

getBK().onPluginEnter(({ payload }) => {
  document.body.textContent = `Input: ${payload}`;
});
```

## Host API 版本

`HOST_API_VERSION` 是 SDK 契约版本（当前为 `1.0.0`），用于判断 API 形状和兼容策略；它不是桌面应用发布版本。宿主发布版本通过 `bk.hostVersion()` 返回。增加破坏性 API 时提升主版本，新增可选 API 或类型时在兼容范围内演进，并在 [CONTRACTS.md](./CONTRACTS.md) 更新矩阵。

当前运行时的 `PluginEnterArgs.payload` 仍是兼容字符串。`input?: VersionedInputPayload` 是 typed input v1 的同步类型，待宿主输入传输启用后提供；插件应继续处理 `payload`，不能假设 `input` 一定存在。

## 权限和信任边界

`plugin.json` 中声明的权限决定宿主 API 是否可调用。缺少权限时宿主拒绝调用并返回错误；legacy 清单按现有兼容安装模型处理。权限不是 Node 沙箱：兼容视图为了支持旧插件仍可能执行插件自带 preload，安装插件等同于信任其代码。

SDK 不模拟账号、云同步、浏览器自动化或第三方私有服务。完整 API、权限映射、通道和 fixture 约束见 [CONTRACTS.md](./CONTRACTS.md)。

## 验证

在仓库根目录执行：

```bash
pnpm --filter @boxkit/sdk build
pnpm --dir packages/sdk pack --dry-run
pnpm --filter @boxkit/sdk test
```

包只发布 `dist`、README、契约矩阵和 MIT LICENSE，不发布 SDK 源码或仓库内构建配置。
