const $ = (id) => document.getElementById(id);

// ————— Tab 切换 —————
let activeTab = "timestamp";

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".tab").forEach((b) => {
    b.classList.toggle("on", b.dataset.tab === tab);
  });
  document.querySelectorAll(".panel").forEach((p) => {
    p.classList.toggle("hidden", p.id !== `tab-${tab}`);
  });
}

document.querySelectorAll(".tab").forEach((b) => {
  b.onclick = () => switchTab(b.dataset.tab);
});

// ————— 复制按钮 —————
document.querySelectorAll(".copy").forEach((btn) => {
  btn.onclick = async () => {
    const el = $(btn.dataset.copy);
    if (!el.value) return;
    await window.bk.writeClipboardText(el.value);
    await window.bk.notify("已复制");
  };
});

// ————— 时间戳 —————
const pad = (n) => String(n).padStart(2, "0");

function fmt(ts) {
  const d = new Date(ts);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

let convIsDateToTs = false;

function tickNow() {
  if (activeTab !== "timestamp" || document.hidden) return;
  const now = Date.now();
  $("now-human").value = fmt(now);
  $("now-sec").value = String(Math.floor(now / 1000));
  $("now-ms").value = String(now);
}

setInterval(tickNow, 500);
tickNow();

function parseInput(raw) {
  const s = raw.trim();
  if (!s) return null;
  // 纯数字 → 时间戳（自动识别秒/毫秒）
  if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000);
  if (/^\d{13}$/.test(s)) return new Date(Number(s));
  const d = new Date(s.replace(/-/g, "/"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function updateConv() {
  const raw = $("conv-in").value;
  const out = $("conv-out");
  if (!raw.trim()) {
    out.value = "";
    return;
  }
  if (convIsDateToTs) {
    const d = new Date(raw.replace(/-/g, "/"));
    if (Number.isNaN(d.getTime())) {
      out.value = "无法解析的日期";
      return;
    }
    out.value = `${Math.floor(d.getTime() / 1000)} (秒) / ${d.getTime()} (毫秒)`;
  } else {
    const d = parseInput(raw);
    out.value = d ? fmt(d.getTime()) : "无法解析的时间戳";
  }
}

$("conv-in").oninput = updateConv;
$("conv-swap").onclick = () => {
  convIsDateToTs = !convIsDateToTs;
  $("conv-in").placeholder = convIsDateToTs
    ? "输入日期，如 2033-01-01 00:00:00"
    : "输入时间戳(秒/毫秒) 或 日期，如 2033-01-01 00:00:00";
  updateConv();
};

// ————— JSON —————
function setStatus(el, ok, msg) {
  el.textContent = msg;
  el.style.color = ok ? "#6fe39a" : "#ff9c9c";
}

$("json-pretty").onclick = () => {
  try {
    $("json-out").value = JSON.stringify(JSON.parse($("json-in").value), null, 2);
    setStatus($("json-status"), true, "✓ 有效 JSON");
  } catch (e) {
    setStatus($("json-status"), false, `✗ ${e.message}`);
  }
};

$("json-min").onclick = () => {
  try {
    $("json-out").value = JSON.stringify(JSON.parse($("json-in").value));
    setStatus($("json-status"), true, "✓ 有效 JSON");
  } catch (e) {
    setStatus($("json-status"), false, `✗ ${e.message}`);
  }
};

$("json-copy").onclick = async () => {
  if (!$("json-out").value) return;
  await window.bk.writeClipboardText($("json-out").value);
  await window.bk.notify("已复制");
};

// ————— UUID —————
$("uuid-gen").onclick = () => {
  const n = Math.min(50, Math.max(1, Number($("uuid-count").value) || 5));
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(crypto.randomUUID());
  $("uuid-out").value = arr.join("\n");
};

// ————— 插件进入：切 Tab + 演示子输入框接管 —————
window.bk.onPluginEnter((args) => {
  switchTab(args.code === "json" || args.code === "uuid" ? args.code : "timestamp");

  if (args.code === "timestamp") {
    // 接管主搜索框：用户输入实时推送为解析结果
    window.bk.setSubInput({ placeholder: "输入时间戳或日期，实时转换…", isFocus: true });
  } else {
    window.bk.removeSubInput();
  }

  if (args.code === "uuid") {
    $("uuid-gen").onclick();
  }
  if (args.code === "json") {
    $("json-in").focus();
  }
});

window.bk.onPluginOut(() => {
  window.bk.removeSubInput();
});

// 子输入框内容 → 实时填入转换输入框
window.bk.onSubInputChange(({ text }) => {
  if (activeTab !== "timestamp") return;
  $("conv-in").value = text;
  updateConv();
  const out = $("conv-out").value;
  if (out && !out.startsWith("无法")) {
    void window.bk.writeClipboardText(out);
  }
});
