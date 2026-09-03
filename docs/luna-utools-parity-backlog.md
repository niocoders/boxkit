# BoxKit 对标 uTools 待实现功能清单

> 交付对象：Luna  
> 审查日期：2026-09-03  
> 审查基线：当前 `open-source/launcher-parity` 工作树，包含尚未提交的快捷键、个人中心和插件独立窗口代码。

## 1. 目标与范围

本文把 BoxKit 与 uTools 当前公开功能、布局和交互的差异整理为可直接实施的任务。目标不是复制 uTools，而是在开源、本地优先的前提下补齐一个成熟桌面效率启动器所需的输入、搜索、插件、窗口和工程能力。

明确不实现：

- 账号注册、登录和身份鉴权；
- 会员、付费权益和商业化能力；
- 依赖闭源后端的云同步、设备互传、评论、评分和支付；
- uTools 私有服务、品牌资源或无法独立实现的内部能力。

可以使用开放协议和公开基础设施实现的市场签名、GitHub Releases 更新、本地导入导出不在排除范围内。

## 2. 当前已实现基线

以下能力已经存在，实施时不要重复建设：

- 全局快捷键搜索面板、托盘、单实例、开机启动；
- Windows、macOS、Linux 应用发现和系统命令；
- 有范围限制的文件搜索；
- 最近使用、使用频率、收藏、模糊匹配和少量首字母匹配；
- 可选剪贴板历史，默认关闭，并带基础敏感内容过滤；
- 本地插件包和开发目录的安装、启停、升级、卸载；
- 静态市场、SHA-256 校验、插件安装暂存确认；
- 插件生命周期、KV/文档存储、剪贴板、通知、窗口、显示器、截图、对话框和外链兼容 API；
- GitHub Releases 更新、三平台打包工作流；
- 当前工作树新增的应用/插件快捷键、个人中心和插件独立窗口雏形。

基线依据见 `README.md:3-14`、`HANDOFF.md:7-25` 和 `docs/plugin-dev.md:43-57`。

## 3. 对标差异摘要

uTools 官方公开文档显示，其核心产品结构包含：多类型输入框、功能指令和智能匹配、聚合/列表搜索、最近使用、应用和系统设置启动、超级面板、插件市场与已安装管理、插件独立窗口、功能级全局快捷键、本地数据管理，以及文本/图片/文件/文件夹输入。

BoxKit 的主要差距不是市场页外观，而是以下链路尚未闭环：

| 领域 | BoxKit 当前状态 | 目标状态 | 优先级 |
| --- | --- | --- | --- |
| 插件安全 | legacy 视图拥有完整 Node 权限，manifest 权限不是真实沙箱 | 原生隔离模式与 legacy 完全信任模式明确分档 | P0 |
| IPC | handler 缺少调用者角色校验，执行目标由 renderer 提交 | sender 角色矩阵、参数 schema、主进程重解析 | P0 |
| 输入 | 主要按字符串搜索，图片和文件声明缺少完整触发链路 | 统一 `text/img/files` typed payload | P0 |
| 插件生命周期 | 停用、卸载、子窗口和 session 清理不完整 | 每插件资源所有权和确定性销毁 | P0 |
| 安装升级 | 缺少资源预算和失败回滚 | 有上限、可恢复、事务性安装升级 | P0 |
| 快捷键 | 冲突可能导致旧唤起键丢失，插件键未绑定具体 feature | 先注册后提交、feature 级绑定 | P0 |
| 独立窗口 | 工具栏、子输入、Escape 和重新附着不完整 | 可调整、可归还、生命周期明确的宿主窗口 | P0 |
| 反馈状态 | 多处把错误吞成空态，执行后无条件隐藏 | loading/empty/error/retry 完整状态 | P0 |
| 搜索布局 | 空态固定九宫格，查询态语义和上下文操作不足 | 高密度分组结果、预览和可访问交互 | P1 |
| 设置布局 | 通用/插件/关于过于集中 | 按快捷键、索引、数据、外观、高级分区 | P1 |
| 超级面板 | 无鼠标附近的上下文动作面板 | 本地 typed payload 上下文面板 | P1 |
| 数据管理 | 缺少索引目录、清空、导入导出和恢复 | 本地数据可见、可控、可恢复 | P1 |
| 多屏 DPI | 部分窗口和截图按主屏计算 | 来源屏定位、bounds 恢复、混合 DPI 正确 | P1 |
| 搜索索引 | 同步扫描、范围固定、拼音能力有限 | worker 增量索引和可配置范围 | P1 |
| 插件生态 | SDK 不可直接发布，兼容能力缺少契约矩阵 | 可发布 SDK 和 fixture 驱动兼容门禁 | P1 |
| 发布维护 | 签名、公证、恢复、打包态验证不完整 | 可验证发行和统一 `pnpm verify` | P2 |

## 4. 实施规则

Luna 实施每张任务卡时必须遵循：

1. 保留当前工作树中的用户改动，不得回退或覆盖无关文件。
2. 一次只完成一张任务卡；跨卡依赖按本文顺序处理。
3. 修改 shared 类型时，同步更新 main、preload、renderer、SDK、文档和测试。
4. 新增 IPC 必须进入共享常量和契约，不允许在 renderer 中使用裸通道字符串。
5. 所有插件兼容行为必须由 fixture 验证，不能仅以 manifest schema 接受字段作为完成。
6. 所有用户操作必须覆盖成功、加载、空、失败和重试状态。
7. UI 必须同时支持键盘和鼠标；不能只通过 hover、不可聚焦的 `div` 或短暂 toast 提供功能。
8. 本地文件路径、剪贴板正文和插件数据不得进入遥测或普通日志。
9. 每张任务至少执行 `pnpm typecheck`、相关单测和相关 Electron smoke；P0 合并前执行完整 `pnpm verify`。

## 5. P0：主链路与发布阻断

### LUNA-P0-01 IPC 调用者隔离与执行目标重解析

**依赖**：无，第一项实施。

**现状证据**：`apps/desktop/src/main/ipc.ts:81-429` 的应用级 handler 普遍未校验 `event.sender`；`apps/desktop/src/main/ipc.ts:129-147` 直接信任 renderer 提交的应用或文件路径；`apps/desktop/src/main/plugins/host.ts:278` 的 legacy 插件可使用 Node 和原生 IPC。

**目标**：建立 `webContents -> role/pluginId` 注册表。角色至少包含 `search`、`settings`、`profile`、`detach-host`、`plugin:<id>`。每个通道声明允许角色、入参 schema、最大消息大小和返回类型。`search:execute` 只接收主进程生成的短期 opaque result ID，并从当前 provider 快照重解析动作。

**验收**：

- search、settings、profile 的合法调用保持可用；
- 插件或模拟远程 frame 调用配置修改、退出、安装、卸载时返回结构化 `FORBIDDEN`；
- renderer 伪造 `filePath`、应用路径或插件名不能执行；
- `ipcMain.handle`、`ipcMain.on` 和同步 IPC 均受同一规则保护；
- 安全拒绝写入脱敏日志，不记录原始 payload。

**涉及模块**：`main/ipc.ts`、所有 window factory、preload、`packages/shared/src/ipc.ts`、安全 fixture。

### LUNA-P0-02 插件安全模式与 legacy 信任模式分档

**依赖**：P0-01。

**现状证据**：`apps/desktop/src/main/plugins/host.ts:277-290` 启用 Node、关闭 context isolation 和 sandbox；`apps/desktop/src/preload/plugin.ts:324-337` 直接加载插件 preload；`host.ts:460-466` 对 legacy 空权限清单默认放行全部宿主权限；`renderer/settings/App.tsx:684-719` 却可能显示“无特殊权限”。

**目标**：

- BoxKit 原生插件默认 `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`；
- 只通过宿主 preload 暴露 manifest 已声明的 API；
- 网络默认拒绝，可按域名声明并授权；
- 需要 Node 或自带 preload 的插件进入显式“legacy 完全信任模式”；
- 安装、详情和已安装列表始终展示真实运行档位，不把 legacy 模式称为沙箱。

**验收**：隔离 fixture 无法访问 `require`、`process`、文件系统、未授权网络和未声明宿主 API；授权能力可用；legacy 插件兼容测试仍通过，并在安装前出现不可跳过的本地代码信任提示。

**涉及模块**：PluginHost、两套 preload、manifest/types、SDK、插件安装与详情 UI、`docs/plugin-dev.md`。

### LUNA-P0-03 typed input 与插件命令契约

**依赖**：P0-01；P0-02 可并行。

**现状证据**：`packages/shared/src/manifest.ts:14-31` 接受 `over/img/files/window`，但 `apps/desktop/src/main/providers/searchEngine.ts:236-255` 主要只处理字符串和正则；`apps/desktop/src/main/ipc.ts:191` 启动插件时可能传入空字符串；当前 smoke 也把空 payload 固化为预期。

**目标**：新增版本化 `InputPayload`：

```ts
type InputPayload =
  | { type: "text"; text: string; source: "typed" | "paste" | "selection" }
  | { type: "img"; mime: string; size: number; tempRef: string }
  | { type: "files"; files: Array<{ path: string; name: string; kind: "file" | "directory" }> };
```

搜索结果保存输入类型和原始 payload 引用，插件按 `text/regex/over/img/files` 声明匹配。落实 `minLength`、扩展名、平台、`mainHide`、`mainPush` 和 `minHostVersion`。旧插件继续收到兼容字符串参数。

**验收**：文本正则插件收到原始文本；图片插件收到有效临时引用；多文件和目录保持顺序；不匹配输入类型的插件不出现；payload 超限返回明确错误；每种命令都有 manifest 单测和真实 Electron fixture。

**涉及模块**：shared types/schema、SearchEngine、search renderer、main preload、IPC、PluginHost、SDK。

### LUNA-P0-04 图片、文件拖放与临时剪贴板输入

**依赖**：P0-03。

**现状证据**：`renderer/search/App.tsx:162-180` 读取不可靠的 `File.path`；main preload 没有使用 Electron 44 的 `webUtils.getPathForFile`；粘贴逻辑未读取图片数据；是否能临时处理输入与剪贴板历史开关耦合。

**目标**：通过 preload 安全提取拖放文件路径和图片数据。输入栏显示文件 chip、目录 chip 或图片缩略图，可逐项删除。当前输入先用于匹配和执行，再独立决定是否写入历史。图片只通过受限大小的临时文件或句柄传递，执行结束和超时后清理。

**验收**：

- Windows、macOS、Linux 可拖入单文件、多文件和目录；
- 粘贴截图立即显示缩略图并只匹配 `img` 能力；
- 剪贴板历史关闭时仍可完成一次性处理，且不落盘；
- `Backspace/Delete` 删除选中 chip，`Esc` 先清 typed input 再隐藏窗口；
- 图片大小、文件数量、路径长度和临时存储均有硬上限。

**涉及模块**：search renderer、main preload、clipboard provider、typed input pipeline、临时文件清理服务。

### LUNA-P0-05 插件资源生命周期与导航边界

**依赖**：P0-01、P0-02。

**现状证据**：`plugins/host.ts:355-374` 的 `destroyView` 未完整销毁 webContents；协议 handler 注册后未成对清理；`host.ts:781-824` 的子窗口没有统一所有权和 session 策略；顶层导航未完整限制。

**目标**：为每个插件维护资源所有权记录，包含主 view、独立宿主、子窗口、session、协议、定时任务和 IPC owner。主 frame 只允许所属 `bk-plugin://<plugin-id>`；外链必须走授权 API。停用关闭运行资源但保留数据；卸载关闭资源并按确认选项清除本地数据和 session。

**验收**：fixture 创建子窗口和持续副作用后，disable/uninstall 能使相关 webContents 数归零；连续 enable/disable/update/reopen 20 次无重复协议错误、空白窗口或旧页面；卸载清数据后重装看不到旧 cookies、cache 和 IndexedDB。

**涉及模块**：PluginHost、PluginManager、detach window、协议和 session 管理、compat smoke。

### LUNA-P0-06 受资源预算约束的事务性插件安装

**依赖**：P0-05。

**现状证据**：`plugins/staging.ts:199-208` 升级时先删除旧目录再移动新目录；归档和市场响应会整包读入内存；`staging.ts:57-77` 缺少 entry 数、展开大小、压缩比、ZIP64、链接和特殊文件限制；平台及 `minHostVersion` 未完整执行。

**目标**：下载和解压采用硬预算；提交前验证平台、宿主版本、包身份和升降级策略；以 candidate、backup、同卷原子替换完成升级，任何阶段失败都回滚旧版本和旧数据。降级必须单独确认。

**验收**：zip-slip、symlink、zip bomb、超大响应、超长路径、错误平台、过高 host version 和非法市场 ID 均被拒绝；在备份、替换、reload 阶段注入失败后旧插件仍可打开，暂存目录清空。

**涉及模块**：staging、manager、market、manifest、安装确认 UI、installer tests。

### LUNA-P0-07 事务性快捷键与 feature 级直达

**依赖**：P0-01、P0-03。

**现状证据**：`services/hotkey.ts:6-18` 在确认新组合键可注册前会注销旧键；`main/ipc.ts:277-285` 先持久化再注册；当前插件快捷键按插件名保存，触发时固定首个 feature。

**目标**：快捷键目标统一为主面板、`app:<id>` 或 `plugin:<name>:<featureCode>`。新组合键先验证并尝试注册，成功后才替换旧绑定和落盘。冲突时保留旧值，显示占用原因和恢复默认入口。

**验收**：录制已占用组合键后旧主快捷键仍能唤起；`Esc` 取消录制，失焦不提交；重复组合键、无效 accelerator、禁用插件和消失应用均显示稳定状态；成功保存后 feature 收到正确 typed payload。

**涉及模块**：config migration、HotkeyService、settings HotkeyRecorder、插件管理、shared types。

### LUNA-P0-08 完成插件独立窗口宿主

**依赖**：P0-03、P0-05、P0-07。

**现状证据**：`renderer/detach/DetachHost.tsx:1` 在 sandbox renderer 直接导入 Electron；`host.ts:312` 对 Escape 的实际行为与界面提示不一致；插件 view 覆盖宿主提示；`host.ts:256` 对脱离插件拒绝子输入。

**目标布局**：保留 36 至 40 DIP 宿主工具栏，包含插件名、可选子输入、归还主面板、置顶、缩放和窗口菜单。插件 view 只占内容区。普通 `Esc` 留给插件，`Ctrl+Esc` 或 `Ctrl/Cmd+W` 执行归还/关闭。所有 renderer IPC 通过 preload 和 shared contract。

**验收**：依赖 `setSubInput` 的插件脱离后仍可输入；插件内部弹窗按 Escape 不会关闭宿主；归还后主面板恢复尺寸和焦点；关闭并重开内容不空白；任何时刻只有一个宿主持有该插件 view。

**涉及模块**：detach renderer、pluginDetachWindow、PluginHost、preload、shared IPC、window smoke。

### LUNA-P0-09 统一异步状态、错误反馈与重试

**依赖**：可与 P0-05 至 P0-08 并行，最后统一接入。

**现状证据**：`renderer/search/App.tsx:86` 将查询异常转为空结果；`App.tsx:242-255` 忽略执行结果并定时隐藏；设置和个人页初始请求失败态不完整。

**目标**：建立共享的 `idle/loading/success/empty/error` 状态模型和面向用户的错误码映射。只有执行返回 `{ok:true}` 才隐藏搜索窗；失败保持原输入、选中项和焦点。安装、更新、启停、卸载、索引均需显示持续状态并防重复提交。

**验收**：模拟 IPC 拒绝、文件失效、应用启动失败、插件崩溃、市场断网和更新失败时，界面保持可操作且提供键盘可达的重试；用户界面不显示堆栈和完整敏感路径。

**涉及模块**：所有 renderer、bridge、IPC result types、插件管理和 updater。

## 6. P1：核心体验对标

### LUNA-P1-01 搜索信息架构与高密度结果布局

**依赖**：P0-03、P0-04、P0-09。

**目标布局**：空查询显示一行“最近使用”和一行“已固定”，后续使用紧凑的应用、插件功能、文件和剪贴板入口；查询态使用 44 至 48px 双行结果，综合评分优先，类型作为弱分组而非打断最优结果。文件、图片或剪贴板结果可打开预览侧栏。结果行提供固定、复制、打开所在目录等上下文动作。

**验收**：802×418 默认面板首屏能显示至少 6 条结果；中英文长名称和路径不会挤压类型与动作；无结果时提供网络搜索、检查索引和前往市场等下一步；收起分组后选中索引不越界。

**现状证据**：`searchEngine.ts:191` 的空查询“全部功能”覆盖有限；`renderer/search/App.tsx:214` 固定四组；`renderer/search/style.css:381` 固定九列布局。

### LUNA-P1-02 搜索、设置和弹窗的键盘与无障碍语义

**依赖**：P1-01。

**目标**：输入框使用 `aria-activedescendant` 控制 `listbox/grid`；结果为 option/gridcell；`Tab` 恢复焦点遍历；上下文菜单支持 `Shift+F10`；所有交互元素具有正确 role、accessible name 和 `:focus-visible`。模态框锁定焦点并在关闭后恢复触发点。

**验收**：不使用鼠标即可完成搜索、执行、固定、打开设置、市场安装、确认/取消和返回；方向键、Enter、左右键和 Esc 具有分层语义；鼠标 hover 不抢走键盘选择；可复制路径和错误文本。

**现状证据**：`renderer/search/App.tsx:337` 劫持 Tab；`App.tsx:451`、`:505` 使用不可聚焦元素；`search/style.css:1` 全局禁止文本选择。

### LUNA-P1-03 插件中心信息架构和信任信息

**依赖**：P0-02、P0-06、P0-09。

**目标布局**：插件中心分为“已安装”和“市场”，支持搜索、运行状态、更新状态和来源过滤。统一详情抽屉显示版本、作者、来源 URL、许可证、构建 commit、哈希/签名状态、功能指令、权限中文说明和运行档位。卸载、覆盖、降级和清除数据使用确认对话框。

**验收**：键盘可完成搜索、详情、安装和取消；市场失败可重试；安装完成后两页状态同步；卸载默认焦点在取消；缺失来源时显示“来源未验证”，而非省略；legacy 插件明确显示完全信任风险。

**现状证据**：`packages/shared/src/types.ts:166` 已有部分来源字段，但 `renderer/settings/App.tsx:369` 未完整展示；`:634` 卸载缺少确认；`:684` 的权限说明不足以表达 Node 信任边界。

### LUNA-P1-04 设置页重组和设置搜索

**依赖**：P0-07、P0-09。

**目标布局**：侧栏重组为“本地概览、通用、快捷键、搜索与索引、剪贴板与本地数据、插件、外观与窗口、高级、关于”。顶部提供设置搜索。更新源和市场源只放在高级页。

**验收**：设置搜索可跳转并高亮目标项；最小 720×520 无横向溢出；Tab 顺序与视觉顺序一致；数字字段允许先清空编辑，只在 Enter 或失焦时提交；配置迁移保留旧用户设置。

**现状证据**：`renderer/settings/App.tsx:10` 仅有通用、插件、关于；`:107` 把更新源、市场源、快捷键和剪贴板集中在通用页；`:159` 数字输入逐字符保存。

### LUNA-P1-05 文件索引、剪贴板和本地数据管理

**依赖**：P1-04。

**目标**：允许配置索引根目录、排除目录、扩展名、最大规模和重建；展示索引状态、进度、取消和错误。剪贴板支持暂停采集、保留数、容量、排除应用、临时无痕和立即清空。增加本地设置/收藏/使用记录/插件数据导出、恢复和重置入口。

**验收**：重建过程不阻塞搜索；清空历史需确认并显示删除数量；导出包不包含未选择的剪贴板正文；损坏配置可从备份恢复；所有数据操作均不依赖账号或云服务。

**现状证据**：`main/providers/files.ts:10` 的扫描根、深度和数量硬编码；剪贴板设置只有开关和条数；持久化文件缺少 schemaVersion 和统一恢复策略。

### LUNA-P1-06 worker 增量索引、拼音和排序质量

**依赖**：P1-05。

**目标**：应用和文件扫描移入 utility process 或 worker，支持取消、增量监听和磁盘缓存；使用成熟拼音库支持全拼、首字母和别名；保留收藏、最近和频次信号，并为排序增加可解释的稳定权重。

**验收**：2,500 文件固定 fixture 下扫描期间主进程 event-loop lag 小于 50ms，搜索 p95 小于 30ms；文件变化无需全量重扫即可出现；常用中文应用可通过汉字、全拼和首字母找到。

**现状证据**：`providers/files.ts:40-86` 和 `providers/apps.ts:29-79` 同步扫描；`searchEngine.ts:73` 使用小型硬编码首字母表。

### LUNA-P1-07 多屏、窗口恢复和混合 DPI

**依赖**：P0-08。

**目标**：所有窗口在来源窗口或鼠标所在显示器创建；保存每类窗口最后 bounds，并在显示器变化后夹紧到有效 workArea；搜索面板按可用工作区调整。截图和选区按目标显示器的 DIP、物理像素和 scaleFactor 转换。

**验收**：左侧、上方和负坐标副屏不越界；100%、125%、150% 混合缩放下窗口及截图无偏移；拔掉显示器后窗口可找回；独立插件窗重开回到原显示器。

**现状证据**：`windows/mainWindow.ts:80` 只为主搜索窗处理鼠标所在屏；其他窗口缺少统一策略；`plugins/host.ts:686`、`:923` 截图按主屏推导。

### LUNA-P1-08 本地超级面板

**依赖**：P0-03、P0-04、P0-07、P1-07。

**目标布局**：在鼠标附近显示 6 至 8 个与当前 `text/img/files` 匹配的插件动作和“更多”。默认通过可配置全局快捷键唤起；鼠标长按或中键手势必须由用户显式开启。选中文本优先通过平台能力读取，失败时可采用“复制、读取、恢复原剪贴板”的受控降级。

**验收**：浏览器/编辑器选中文本后可在当前显示器唤起；选中文件或图片只展示兼容动作；方向键、数字键、Enter、Esc 和点击空白可完整操作；执行失败保留上下文重试；输入默认不上传、不写历史。

**风险**：macOS 辅助功能权限、Linux 桌面环境差异、全局鼠标 hook 和剪贴板恢复。必须提供仅快捷键模式，不得因手势不可用阻塞功能。

### LUNA-P1-09 本地概览替代“个人中心”

**依赖**：P1-04。

**目标**：将个人中心改名“本地概览”并并入设置首项。展示真实使用天数、次数大于零的常用应用、最近功能、固定项、版本和本地诊断入口。不要使用头像、登录暗示、会员入口或云端术语。

**验收**：首次使用显示真实空态，不闪烁零次数应用；应用启动失败有反馈；点击搜索栏概览图标复用现有设置窗口；全部数据来自本机。

**现状证据**：`windows/profileWindow.ts:53` 会包含零次数应用；`renderer/profile/Profile.tsx:23-36` 有假空态、错误反馈和视觉一致性问题。

### LUNA-P1-10 可发布 SDK 与插件兼容契约矩阵

**依赖**：P0-02、P0-03、P0-05。

**目标**：`@boxkit/sdk` 输出 ESM、CJS 和 `.d.ts`，包含 README、LICENSE、最小插件模板、host API version、兼容矩阵和弃用策略。建立“shared 通道、preload 暴露、main handler、SDK 类型、文档、fixture”契约矩阵并在 CI 比对。

**验收**：`pnpm --filter @boxkit/sdk build` 和 `pnpm --dir packages/sdk pack --dry-run` 通过；tarball 在空白项目中可用 ESM、CJS 和 TypeScript 导入；每个公开 API 至少有一个正向 fixture，权限 API 另有拒绝 fixture。

**现状证据**：`packages/sdk/package.json:20-29` 指向 TypeScript 源并声明不存在的包内文件；当前无 SDK build/test/publish scripts。

## 7. P2：工程、发布与维护

### LUNA-P2-01 配置迁移、原子持久化和恢复

为配置、usage、剪贴板和插件数据增加 runtime schema、`schemaVersion`、逐级 migration、同目录临时文件、原子 rename、滚动 `.bak` 和 quarantine。退出统一 flush。使用旧版、截断 JSON 和写入中断 fixture 验证，不允许迁移失败后覆盖原数据。

### LUNA-P2-02 崩溃恢复、安全模式和更新闭环

先加载设置再初始化可选 Sentry；本地崩溃记录不依赖云服务。renderer 最多自动重建一次；通过 clean-shutdown、last-plugin 和版本健康标记识别崩溃循环，进入安全模式并临时禁用可疑插件。更新 idle 显示“尚未检查”，默认 feed 延迟检查，自定义 feed 仅允许 HTTPS 或 loopback HTTP。

现状依据：`main/index.ts:178-187`、`services/crash.ts:16-39`、`services/updater.ts:83-86`、`renderer/settings/App.tsx:887-893`。

### LUNA-P2-03 插件清单、正则、IPC 和存储资源预算

限制 manifest 字节数、feature/cmd 数、字符串长度、正则数量、IPC 消息大小、单值和插件总存储配额。对 regex 使用安全检查或可超时执行环境，避免灾难性回溯冻结主进程。超限错误必须在安装预览或插件界面中可见。

### LUNA-P2-04 静态市场签名与本地标识隐私

SHA-256 只能证明下载内容与同源 registry 一致，不能证明 registry 来源。为公开市场增加离线 Ed25519/minisign 签名、publisher key、源码 commit、构建摘要和撤销状态；未知或撤销 key 默认阻止安装。将原始 machine ID 替换为每安装、每插件隔离的随机本地标识，并提供重置。

### LUNA-P2-05 统一验证命令和三平台打包态门禁

新增 `pnpm verify`，统一执行 lint、format check、typecheck、unit、coverage、IPC 安全、installer、compat、UI 和 packaged smoke。三平台 CI 均运行 compat 和打包态启动；smoke 诊断失败必须非零退出。原生对话框、截图选区、协议、`.bkx` 和文件拖放不得永久 skip。

### LUNA-P2-06 正式发行签名、公证和版本一致性

正式更新渠道只发布签名产物：macOS Developer ID + notarization，Windows Authenticode。无证书社区构建标记 unsigned，不生成正式 update feed。CI 校验 tag、根 package、desktop package 和 update metadata 版本完全一致，并生成 checksums、SBOM 和 provenance。

现状依据：`apps/desktop/electron-builder.yml:36-80`、`.github/workflows/release.yml:35-75`。

### LUNA-P2-07 工具链、包内容和体积预算

统一 Node `>=22.12` 和 pnpm lockfile；增加 lint、format、依赖审计和许可证检查；GitHub Actions 固定到 commit SHA。构建在“bundle 依赖”与“external + node_modules”中只保留一种策略，生产 ASAR 排除 sourcemap 和开发工具，并为各平台定义体积上限。

### LUNA-P2-08 本地性能诊断和统一视觉系统

日志结构化、脱敏、按大小和天数轮转；提供不含用户正文的本地 diagnostics JSON，记录启动、索引、搜索、插件载入、慢 IPC、内存和 event-loop lag。统一 search/settings/detach/overview 的设计 token、Lucide 图标、浅深/高对比主题、紧凑密度和不超过 8px 的常规圆角。

## 8. 推荐实施顺序

按以下里程碑执行，不要跨阶段抢做界面：

1. **M0 安全底座**：P0-01、P0-02、P0-05、P0-06。
2. **M1 输入与直达**：P0-03、P0-04、P0-07。
3. **M2 稳定窗口和反馈**：P0-08、P0-09。
4. **M3 搜索与插件中心**：P1-01、P1-02、P1-03。
5. **M4 设置和本地数据**：P1-04、P1-05、P1-06、P1-09。
6. **M5 上下文效率**：P1-07、P1-08。
7. **M6 插件生态**：P1-10、P2-03、P2-04。
8. **M7 发布质量**：全部 P2 工程任务。

M0 至 M2 完成前，不开始超级面板。typed payload、权限边界和插件生命周期不稳定时新增入口只会放大现有问题。

## 9. 通用 Definition of Done

每张任务卡完成必须同时满足：

- 新增行为有单元测试或契约测试；
- 用户可见链路有真实 Electron Playwright smoke；
- 覆盖成功、加载、空、错误和重试；
- 覆盖键盘和鼠标，焦点清晰且不丢失；
- 涉及窗口时覆盖 100% 和 150% DPI；
- 涉及平台能力时至少在 Windows、macOS、Linux CI 分别验证可支持部分；
- shared、preload、main、renderer、SDK 和文档保持一致；
- 不引入账号、鉴权、会员或闭源云服务；
- 不把 legacy Node 插件描述为受沙箱保护；
- `pnpm typecheck`、相关测试、`pnpm build` 通过，无新增未解释 warning。

## 10. uTools 公开资料基准

本次比较使用 2026-09-03 可访问的官方公开页面：

- 产品能力：<https://www.u-tools.cn/>
- 输入框与多类型输入：<https://www.u-tools.cn/docs/guide/uTools-search-bar.html>
- 超级面板：<https://www.u-tools.cn/docs/guide/uTools-super-panel.html>
- 功能指令与智能匹配：<https://www.u-tools.cn/docs/guide/what-is-keyword.html>
- 插件市场与已安装管理：<https://www.u-tools.cn/docs/guide/plugin-store.html>
- 插件窗口与独立窗口：<https://www.u-tools.cn/docs/guide/plugin-interface.html>
- 设置布局：<https://www.u-tools.cn/docs/guide/preferences.html>
- 本地文件启动：<https://www.u-tools.cn/docs/guide/local-file-launch.html>
- 功能级全局快捷键：<https://www.u-tools.cn/docs/guide/global-shortcut.html>
- 本地和插件数据入口：<https://www.u-tools.cn/docs/guide/my-data.html>
- 开发者能力目录：<https://www.u-tools.cn/docs/developer/basic/getting-started.html>

这些页面只作为功能和交互基准。实现必须使用 BoxKit 自有代码、命名、视觉和开放协议。
