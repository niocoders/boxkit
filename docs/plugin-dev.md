# Plugin Development

BoxKit plugins are independently published static web applications. The desktop app provides discovery, installation, a compatibility adapter, and a small set of host APIs.

## Layout

```text
my-plugin/
  plugin.json
  index.html
  preload.js       # optional Node/preload adapter
  logo.svg         # optional
```

The compatibility view intentionally supports Node/preload execution for existing plugin packages and disables context isolation. Installing a plugin therefore means trusting and executing local code. The permission list limits host APIs; it does not sandbox Node or network access.

## Manifest

```json
{
  "name": "example-tool",
  "displayName": "Example Tool",
  "version": "1.0.0",
  "description": "A short description",
  "author": "Example Authors",
  "license": "MIT",
  "main": "index.html",
  "features": [
    {
      "code": "convert",
      "explain": "Convert text",
      "cmds": ["convert", "转换"]
    }
  ],
  "permissions": ["clipboard"]
}
```

Resource paths must be safe relative paths inside the plugin root. Absolute paths, null bytes and `..` segments are rejected.

The compatibility adapter accepts common legacy manifest fields and normalizes the legacy plugin name and minimum input length. Unknown descriptive fields are preserved but do not change host execution. Regex commands may specify `match`, `minLength`, `explain`, or equivalent legacy fields.

## Permissions

- `clipboard`: read and write the system clipboard
- `db`: store plugin-local data
- `notify`: send notifications
- `network`: declare network use
- `shell`: open external links or paths
- `screen`: read display information or capture a region
- `window`: resize the view, use the sub-input, or create a child window

## APIs

Use `window.bk` for the native BoxKit API. The compatibility adapter also exposes the legacy global API for packages that have not migrated. Both provide lifecycle callbacks, sub-input handling, local KV/document storage, clipboard access, notifications, window/display helpers, dialogs, screenshots, and external links.

Account services, cloud synchronization, browser automation, third-party private backends and cloud copy semantics are intentionally not faked. The device token API returns a local host token, not a third-party account token.

## Packaging and installation

`.bkx`, `.zip`, and `.upx` are zip archives containing a valid `plugin.json`. The installer:

1. checks the zip central directory for traversal entries;
2. extracts into a random staging directory and validates the manifest and resources;
3. verifies the market registry SHA-256 digest when installed from the market;
4. shows permissions and the trust boundary before committing the plugin.

Cancellation and failure remove the staging directory. Market packages must also match the registry plugin ID and version.

## Local development

Open Settings, Plugins, and add a directory containing `plugin.json`. Development plugins are marked separately and may open DevTools. Local HTTP market feeds are allowed only on loopback addresses; published feeds must use HTTPS.

## Market publishing

Plugin source, registry metadata, packages, and templates are maintained in the independent public market repository. Each entry should include a maintainer, source URL, and license. The market workflow validates manifests, creates packages, writes a 64-character SHA-256 digest, and publishes the Pages site.
