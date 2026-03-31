---
trigger: always_on
---

# Build & Test Guidelines

## Build Modes

### Dev build
- `tsc` compiles to `out/`.
- `package.json` `"main"` points to `./out/extension.js`.

### Production build
- `esbuild` bundles to `dist/`.
- The build script patches `package.json` `"main"` to `./dist/extension.js` at packaging time via `setPackageMain`.

## Testing

- **`npm test`** runs `tsc` + `eslint` + `vscode-test`.
- Integration tests activate the extension using `package.json`'s `"main"` entry, so it **must** point to `./out/extension.js` in the committed file.

## Rules

### Never change `"main"` permanently
Do not change `"main"` in `package.json` to `./dist/extension.js` permanently — it will break `npm test` after `rm -rf out/ dist/`.

### Always verify before done
Always verify changes with `rm -rf out/ dist/ && npm test` before considering work done.
