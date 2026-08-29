import { contextBridge, ipcRenderer } from "electron";
// 注意：沙箱 preload 只允许引入无 Node 内建依赖的子模块（ipc.ts 仅常量）
import { IPC } from "@boxkit/shared/ipc";

/**
 * 插件沙箱 preload（contextIsolation + sandbox）。
 * 仅暴露白名单化的 window.bk API；身份（插件 ID）由主进程根据 sender 判定，
 * 插件无法伪造他人身份或访问未声明权限的能力。
 */

type Cb<T> = (arg: T) => void;

const enterCbs: Cb<{ code: string; type: string; payload: string }>[] = [];
const outCbs: Cb<void>[] = [];
const subInputCbs: Cb<{ text: string }>[] = [];

ipcRenderer.on(IPC.pkEnter, (_e, args) => enterCbs.forEach((cb) => cb(args)));
ipcRenderer.on(IPC.pkOutEvent, () => outCbs.forEach((cb) => cb()));
ipcRenderer.on(IPC.pkSubInputChange, (_e, args) => subInputCbs.forEach((cb) => cb(args)));

const bk = {
  onPluginEnter(cb: Cb<{ code: string; type: string; payload: string }>) {
    enterCbs.push(cb);
  },
  onPluginOut(cb: Cb<void>) {
    outCbs.push(cb);
  },
  onSubInputChange(cb: Cb<{ text: string }>) {
    subInputCbs.push(cb);
  },

  setSubInput(options: { placeholder: string; isFocus?: boolean }) {
    ipcRenderer.send(IPC.pkSubInputSet, {
      placeholder: String(options?.placeholder ?? ""),
      isFocus: !!options?.isFocus,
    });
  },
  removeSubInput() {
    ipcRenderer.send(IPC.pkSubInputRemove);
  },

  outPlugin() {
    ipcRenderer.send(IPC.pkOut);
  },
  notify(body: string) {
    ipcRenderer.send(IPC.pkNotify, String(body ?? ""));
  },
  copyText(text: string) {
    ipcRenderer.invoke(IPC.pkClipboardWrite, String(text ?? ""));
  },
  readClipboardText(): Promise<string> {
    return ipcRenderer.invoke(IPC.pkClipboardRead);
  },
  writeClipboardText(text: string): Promise<void> {
    return ipcRenderer.invoke(IPC.pkClipboardWrite, String(text ?? ""));
  },

  db: {
    get<T = unknown>(key: string): Promise<T | null> {
      return ipcRenderer.invoke(IPC.pkDbGet, String(key));
    },
    put(key: string, value: unknown): Promise<void> {
      return ipcRenderer.invoke(IPC.pkDbPut, String(key), value);
    },
    remove(key: string): Promise<void> {
      return ipcRenderer.invoke(IPC.pkDbRemove, String(key));
    },
    all(): Promise<{ key: string; value: unknown; updateAt: number }[]> {
      return ipcRenderer.invoke(IPC.pkDbAll);
    },
  },

  openExternal(url: string): Promise<void> {
    return ipcRenderer.invoke(IPC.pkOpenExternal, String(url ?? ""));
  },
  setViewHeightRatio(ratio: number) {
    ipcRenderer.send(IPC.pkResize, Number(ratio));
  },
  getPrimaryDisplaySize(): Promise<{ width: number; height: number }> {
    return ipcRenderer.invoke(IPC.pkDisplaySize);
  },

  info(): Promise<{
    name: string;
    displayName: string;
    version: string;
    permissions: string[];
    path: string;
  } | null> {
    return ipcRenderer.invoke(IPC.pkInfo);
  },
  hostVersion(): string {
    // 宿主版本通过 UA 注入（见主进程 app.userAgentFallback）
    return navigator.userAgent.match(/BoxKit\/([\d.]+)/)?.[1] ?? "unknown";
  },
};

contextBridge.exposeInMainWorld("bk", bk);
