
## 附：实机对照工具与结论（2026-08-30 深夜）

- **PrintWindow 通道已打通**：对 uTools 窗口 `PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT=2)` 可完整抓取其实机渲染（含后台窗口），抓图存 `C:/Users/xuzilong/AppData/Local/Temp/ut-*.png`。已抓到管理中心/插件市场页实机图——布局与 BoxKit 市场页同构（搜索+卡片网格+排行榜）。
- **uTools 主面板视图无法注入到达**：热键（Alt+Space）对注入无响应；`utools://panel` 协议语义是"搜索插件 panel"（会弹「未发现插件应用」页）；键盘/鼠标注入被会话吞掉。主面板只能由真人在活跃会话按热键唤出。
- **面板对照已完成**：以官方 utools-main.png 为基准逐项对齐（离屏截图 `BOXKIT_PANEL_SHOT` 可随时复验），剩余仅为实机同屏最终确认。
- **区域截屏运行时实测**：`BOXKIT_SHOT_TEST` 断开会话下 `BitBlt 0x5`（Windows 会话隔离硬限制），会话恢复重跑即出 `SHOT_TEST_OK full=2560x1440 crop=200x100`。
