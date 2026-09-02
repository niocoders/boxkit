# BoxKit 插件开发指南

BoxKit 插件是一个与主程序**独立发布**的静态 Web 应用，运行在兼容 uTools 的插件视图中。插件源码、官网、发行包和开发模板统一托管在公开仓 [`niocoders/boxkit-market`](https://github.com/niocoders/boxkit-market)；主程序仓只包含运行时、安装器和客户端市场页。

官方模板见公开仓的 [`template/`](https://github.com/niocoders/boxkit-market/tree/main/template)，本地开发时通过 BoxKit 设置 → 插件 → 「添加开发目录」加载。

---

## 1. 目录结构

```
my-plugin/
├── plugin.json      # 清单（必需）
├── index.html       # 入口页面（默认 main）
├── preload.js       # 可选：uTools/BoxKit preload（可使用 Node，兼容模式）
├── logo.svg         # 插件 logo（可选）
└── ...              # 其余静态资源，全部随插件分发
```

> **兼容运行模型**：为兼容现有 uTools 插件，插件视图使用 `nodeIntegration: true`、`contextIsolation: false`。插件可直接使用 Node 和自带 preload；这意味着“安装即信任”，权限弹窗只约束宿主提供的 API，不是 Node 沙箱。

> `preload.js` 可以保留 uTools 原写法，BoxKit 会先挂载 `window.utools`/`window.bk`，再加载插件自带 preload。

## 2. plugin.json 清单

```jsonc
{
  "name": "my-plugin",              // 唯一 ID：小写字母/数字/中划线，2~64 位
  "displayName": "我的插件",          // 展示名
  "version": "1.0.0",               // semver
  "description": "一句话描述",
  "author": "you",
  "main": "index.html",             // 入口 HTML（默认 index.html）
  "preload": "preload.js",          // 可选
  "logo": "logo.svg",
  "permissions": ["clipboard", "db"],
  "features": [                     // 至少 1 个 feature
    {
      "code": "main",               // feature code：字母数字下划线中划线
      "explain": "示例功能",
      "cmds": ["示例", "demo"]      // 唤起关键字；也支持正则（见下）
    }
  ],
  "minHostVersion": "1.0.0"         // 可选：宿主最低版本
}
```

### uTools 清单兼容

BoxKit 保留并归一化 uTools 常见字段：`pluginName`、`description`、`author`、`main`、`preload`、`logo`、`platform`、`version`、`homepage`、`pluginSetting`；`features` 支持 `platform`、`icon`、`mainHide`、`mainPush`；`cmds` 支持字符串以及 `regex/img/files/window/over` 等对象（regex 的 `minNum` 会归一为 `minLength`）。未知描述字段会保留，不参与宿主执行。

插件包扩展名支持 `.bkx`、`.zip`、`.upx`（三者本质都是 zip）。包内必须有 `plugin.json`，入口路径必须是插件根目录内的相对路径，安装器会检查 zip-slip 和入口文件。

- **字符串**：搜索面板输入匹配该关键字即命中（支持拼音包含等评分排序）。
- **正则匹配器**：适合"把任意输入交给插件处理"的场景，例如让时间戳数字直接唤起：

```json
{
  "code": "timestamp",
  "explain": "时间戳转换",
  "cmds": [
    "时间戳",
    { "type": "regex", "match": "^\\d{10,13}$", "minLength": 10, "explain": "识别为时间戳" }
  ]
}
```

- `match`：JS 正则（对用户输入整体匹配）
- `minLength`：输入至少多少字符才尝试匹配（避免过度命中）
- `explain`：命中后的展示说明

## 3. 权限

`permissions` 声明后，安装时用户会看到逐项确认弹窗，未授权的 API 调用会被主进程拦截：

| 权限 | 说明 |
|---|---|
| `clipboard` | 读写系统剪贴板 |
| `db` | 插件本地 KV 存储 |
| `notify` | 发送通知气泡 |
| `network` | 访问网络 |
| `shell` | 打开外部链接与应用 |
| `screen` | 获取屏幕尺寸 |
| `window` | 调整插件视图尺寸 |

## 4. `window.bk` API 速览

类型全量定义见 [`packages/sdk`](../packages/sdk/src/index.ts)（`npm i @boxkit/sdk` 或直接拷贝类型文件）。

### 生命周期

```ts
bk.onPluginEnter(({ code, type, payload }) => {
  // 用户通过某个 feature 进入插件；payload 为命中关键字时的原始输入
});
bk.onPluginOut(() => {});   // 退出插件
bk.outPlugin();             // 主动退出，返回搜索面板
```

### 子输入框（接管主搜索框）

```ts
bk.setSubInput({ placeholder: "输入时间戳…" });
bk.onSubInputChange((text) => render(text));  // 实时推送输入
bk.removeSubInput();
```

### 剪贴板 / 通知 / 存储

```ts
await bk.readClipboardText();
await bk.writeClipboardText("hello");
bk.copyText("hello");
bk.notify("已完成");

await bk.db.put("items", [1, 2, 3]);   // 插件隔离 KV，随插件卸载删除
const items = await bk.db.get<[number]>("items");
await bk.db.all();                      // KVItem[]
```

### 其它

```ts
await bk.openExternal("https://example.com");  // 需 shell 权限
bk.setViewHeightRatio(0.6);                     // 需 window 权限
const { width, height } = await bk.getPrimaryDisplaySize();  // 需 screen 权限
const info = await bk.info();                   // 插件自身信息
bk.hostVersion();                               // 宿主版本
```

## 5. 调试（开发者模式）

1. 设置 → 插件 → 「添加开发目录」，选择含 `plugin.json` 的目录。
2. 保存后 400ms 防抖自动热重载；改代码即生效。
3. 开发目录插件打开时会自动弹出独立 DevTools（已安装插件可用环境变量 `BOXKIT_PLUGIN_DEVTOOLS=1` 启动宿主开启）。

开发目录插件不参与打包分发，仅在开发机上生效。

## 6. 分发：.bkx 插件包

`.bkx` 是 zip 格式的插件包（扩展名改为 `.bkx`），内含 `plugin.json` 与全部静态资源：

```bash
cd my-plugin && zip -r ../my-plugin.bkx . -x ".*"
```

安装方式：

- 直接把 `.bkx` 拖入/复制到用户，双击即可唤起 BoxKit 安装确认；
- 或设置 → 插件 → 「安装插件包」选择文件；
- 或发布到插件市场让用户一键导入（见下节）。

安装流程：解压到暂存目录 → 展示清单与权限确认 → 用户同意后提交到用户 `plugins/` 目录。安装器会拒绝 zip-slip、绝对路径和越过插件根目录的 `main/preload/logo`。

## 6.1 发布到插件市场（GitHub Pages 静态市场）

插件市场、官网和本文档均在公开仓 [`niocoders/boxkit-market`](https://github.com/niocoders/boxkit-market)。主程序仓不保存插件源码，也不需要发布 token。

1. 在公开仓 `plugins/<id>/` 新建或修改插件目录（含 `plugin.json`，可保留 uTools 原始字段）；
2. 更新 `plugin.json` 的 `version` 后 push 到公开仓 main；
3. 公开仓自己的 Pages workflow 校验清单、固定 ZIP 时间戳打包 `.bkx`，生成 `site/manifest.json`、`site/plugins/*.bkx`、`site/logo/*` 并部署；
4. 用户从 [市场门户](https://niocoders.github.io/boxkit-market/) 浏览/下载，或在 BoxKit 客户端市场页直接安装。

`.bkx`、`.zip`、`.upx` 都是可安装的 zip 包。市场 registry 的 `manifest.json` 只承载卡片/版本/sha256 元数据，完整 uTools `plugin.json` 留在包内，由客户端安装器最终校验。

**升级插件**：改 `plugin.json` 的 `version` 后 push 即可，客户端会显示「可更新」。公开仓 CI 校验失败（清单非法、入口缺失、路径越界）会直接红灯，不会更新线上市场。

## 7. 兼容性说明

- 当前已实现并可用：生命周期（含 `onPluginDetach` / `onDbPull`）、子输入框、主窗口控制、通知、剪贴板文本/图片、同步文档 DB、外部链接/路径、显示器信息、打开/保存对话框、区域截屏、按键注入、`createBrowserWindow`、`redirect`、版本/深色环境信息。
- 兼容降级：uTools 账号/云端同步、`ubrowser`、私有后端和云端复制语义不伪造；`fetchUserServerToken` 返回 BoxKit 本地设备令牌，网络权限为声明性元数据（兼容模式下插件 Node/fetch 不经宿主代理）。
- `copyText/copyImage` 返回 boolean；`screenCapture` 回调为 `data:image/png;base64,...`；`plugin.json` 原始未知字段会保留。

## uTools 插件兼容（重要）

BoxKit 的插件运行时与 uTools 同构：**插件页面与 preload 具备 Node 能力、无上下文隔离**，uTools 插件基本可以零改动运行：

- 清单兼容：uTools 的 `pluginName` 自动归一化为 `name`（英文转 slug，纯中文回退稳定哈希）+ `displayName`；正则关键字 `minNum` 自动映射为 `minLength`
- `window.utools` 兼容 API（与 `window.bk` 并存）：
  - 生命周期：`onPluginEnter / onPluginOut / onSubInputChange / setSubInput / removeSubInput / outPlugin`
  - 窗口：`hideMainWindow / showMainWindow`
  - 通知：`notify`（系统通知，点击回面板）
  - 剪贴板：`copyText / readClipboardText / copyImage(png) / readClipboardImage()`
  - 文档存储（同步，pouchdb 风格）：`db.put / get / remove / allDocs / post`（`_id/_rev` 冲突检测）
  - 系统：`openExternal / openPath / getPrimaryDisplay / getAllDisplays / showOpenDialog / showSaveDialog`
  - 按键注入：`simulateKeyboardTap(key, ...modifiers)`（作用于当前焦点窗口）
  - 子窗口：`createBrowserWindow(url, options, callback)`（回调句柄提供 `send(channel, data)`）
  - 环境：`isDarkColors / getAPIVersion / getAppVersion`
- 跳转：`redirect({ cmd, payload? })`（按关键字跳到其他插件功能）
- 账号：`fetchUserServerToken()`（返回 BoxKit 本地用户令牌——设备指纹 HMAC）
- 截屏：`screenCapture(cb)`（隐藏面板 → 全屏遮罩拖拽选区 → PNG 回调，Esc 取消）

安全说明：与 uTools 相同，插件具备 Node 能力意味着「安装即信任」——请只安装来源可信的插件；安装时的权限确认弹窗列出敏感能力。
