# SDK Contract Matrix

`HOST_API_VERSION` is the stable API shape version (`1.0.0`). `bk.hostVersion()` is the host application version and may change independently.

| Contract | Shared channel / handler | Preload exposure | SDK type | Fixture / status |
| --- | --- | --- | --- | --- |
| Plugin enter | `pk:enter` | `onPluginEnter` | `PluginEnterArgs` | positive fixture; legacy `payload: string` required |
| Plugin exit | `pk:out-event` | `onPluginOut` | callback `() => void` | positive fixture |
| Sub-input | `pk:subinput:*` | `setSubInput`, `removeSubInput`, `onSubInputChange` | `BKApi` | positive fixture; requires `window` |
| Local KV | `pk:db-*` | `bk.db` | generic KV methods | positive fixture; requires `db` |
| Clipboard | `pk:clipboard-*` | read/write clipboard methods | `BKApi` and legacy methods | positive fixture; requires `clipboard` |
| Notification | `pk:notify` | `notify` | `BKApi` and legacy method | positive fixture; requires `notify` |
| Shell | `pk:open-*`, dialogs | `openExternal`, `openPath` | `BKApi` and legacy methods | positive fixture; requires `shell` |
| Display / capture | `pk:display-*`, `pk:screen-*` | display and capture methods | `BKApi` and legacy methods | positive fixture; requires `screen` |
| View / child window | `pk:resize`, `pk:create-browser-window` | resize and child window methods | `BKApi` and legacy methods | positive fixture; requires `window` |
| Typed input v1 | future versioned transport | optional `PluginEnterArgs.input` | `InputPayload` | type fixture; not enabled by current host |

## Compatibility Rules

- `PluginEnterArgs.payload` remains a string in host API v1. Plugins must not require `input` until the host advertises the versioned transport.
- `HOST_API_VERSION` changes only for API shape compatibility decisions. Host application releases do not change it automatically.
- Missing permissions are rejected by the host with `插件未声明权限: <permission>`. This is a runtime fixture requirement even though the SDK itself contains no privileged implementation.
- Legacy manifests with no permission fields retain the existing trusted compatibility behavior; new manifests should declare every requested permission.
- Additive optional methods and fields may ship in a minor contract revision. Removing or changing a required method requires a major contract revision and a migration note here.
