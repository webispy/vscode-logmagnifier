---
description: How to publish the extension to VS Code Marketplace
---

# Publishing LogMagnifier to VS Code Marketplace

Follow these steps to release your extension to the public.

## 1. Prerequisites

- **Microsoft Account**: You need a Microsoft account.
- **Azure DevOps Organization**:
    1. Go to [Azure DevOps](https://dev.azure.com/).
    2. Create a new organization (if you don't have one).
- **Personal Access Token (PAT)**:
    1. In Azure DevOps, go to **User Settings** > **Personal Access Tokens**.
    2. Click **New Token**.
    3. Name: `VS Code Marketplace` (or similar).
    4. Organization: `All accessible organizations`.
    5. Scopes: Select `Custom defined`, then find **Marketplace** and select **Manage**.
    6. **Copy the token**. You won't see it again!

## 2. Install vsce tool

The Visual Studio Code Extensions (vsce) tool is used for packaging and publishing.

```bash
npm install -g @vscode/vsce
```

*Or you can use `npx @vscode/vsce` to run it without installing.*

## 3. Create a Publisher

You need a publisher ID on the Marketplace.

1. Go to the [Marketplace Management Page](https://marketplace.visualstudio.com/manage).
2. Click **Create publisher**.
3. **Name**: `webispy` (This MUST match the `publisher` field in `package.json`).
4. **ID**: `webispy`.

*Note: I have already configured `package.json` with `"publisher": "webispy"`. If you choose a different ID, update `package.json` first.*

## 4. Login to vsce

Authenticate `vsce` with your Personal Access Token (PAT).

```bash
vsce login webispy
```
*Enter your PAT when prompted.*

## 5. Package and Publish

### To just build a VSIX file (for manual install):
```bash
vsce package
```
*This creates `logmagnifier-0.0.1.vsix`.*

### To publish to Marketplace:
```bash
vsce publish
```
*This will build, verify, and upload the extension.*

## 6. Verification
After publishing, it may take a few minutes for the extension to appear. verify it at:
`https://marketplace.visualstudio.com/items?itemName=webispy.logmagnifier`
