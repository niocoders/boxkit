// 页面脚本：window.bk 由 BoxKit 沙箱注入（类型见 @boxkit/sdk）
window.bk.onPluginEnter((args) => {
  document.getElementById("hello").textContent = `进入 feature: ${args.code}`;
  void window.bk.info().then((info) => {
    document.getElementById("info").textContent = `${info.displayName} v${info.version}`;
  });
  void window.bk.notify("插件已启动");
});
