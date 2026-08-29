// 沙箱 preload 示例：可在此做进入插件前的初始化（window.bk 尚未挂载，
// 主进程会先加载 preload 再加载页面，页面脚本里可直接使用 window.bk）。
console.log("[clipboard-history] preload loaded");
