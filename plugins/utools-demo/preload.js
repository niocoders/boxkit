// uTools 风格 preload：与 uTools 插件写法一致，直接使用 utools 全局
utools.onPluginEnter(({ code, payload }) => {
  window.currentFeature = code;
  window.enterPayload = payload;
  const el = document.getElementById("status");
  if (el) el.textContent = `进入功能: ${code}${payload ? ` · 输入: ${payload}` : ""}`;
});

utools.onPluginOut(() => {
  window.currentFeature = undefined;
});
