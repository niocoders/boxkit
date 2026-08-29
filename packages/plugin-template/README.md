# my-plugin — BoxKit 插件模板

## 本地开发

1. 打开 BoxKit 设置 → 插件 → 「添加开发目录」，选择本目录（含 plugin.json）
2. 修改代码保存后自动热重载（无需重启 BoxKit）
3. 在搜索框输入关键字 `hello` / `你好` 回车即可进入插件

## 打包分发

```bash
# 把目录打包为 .bkx（即 zip）
cd my-plugin && zip -r ../my-plugin-1.0.0.bkx . -x '*.DS_Store'
```

双击 `.bkx` 或在设置 → 插件 → 安装插件包 完成安装，安装时会向用户展示权限确认。

## 清单字段

见 `plugin.json`：
- `features[].cmds`：字符串关键字，或 `{"type":"regex","match":"^\\d{13}$","minLength":4}` 正则匹配
- `permissions`：`clipboard / db / notify / network / shell / screen / window`
- `preload`：可选沙箱预加载脚本

## API

TypeScript 类型：`pnpm add @boxkit/sdk`（或直接使用 `window.bk`）。
完整文档见仓库 `docs/plugin-dev.md`。
