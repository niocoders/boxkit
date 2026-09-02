# Third-party licenses

BoxKit's direct runtime and build dependencies are distributed under their own
licenses. The lockfile records exact versions and integrity data.

| Component | License | Use |
|---|---|---|
| Electron | MIT | Desktop runtime |
| React / React DOM | MIT | Renderer UI |
| TypeScript | Apache-2.0 | Type checking and build tooling |
| Vite | MIT | Renderer build |
| esbuild | MIT | Main and preload bundling |
| electron-builder | MIT | Installer packaging |
| electron-updater | MIT | Release update client |
| zod | MIT | Manifest validation |
| Vitest | MIT | Test runner |
| Sentry Electron SDK | MIT | Optional crash reporting |

Transitive dependency notices are supplied by each package manager package and
must remain available when redistributing a build. This inventory is a concise
direct-dependency summary, not a replacement for the license files shipped by
those projects.
