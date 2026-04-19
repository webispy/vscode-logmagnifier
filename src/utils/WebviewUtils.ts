import * as crypto from 'crypto';
import * as vscode from 'vscode';

import { Logger } from '../services/Logger';

/** Generates a cryptographically random nonce for CSP-compliant webview scripts. */
export function getNonce(): string {
    return crypto.randomBytes(16).toString('base64');
}

/**
 * Injects a fresh nonce and CSP source into a webview HTML template.
 * Templates should use `{{ CSP_SOURCE }}` and `{{ NONCE }}` placeholders.
 */
export function applyWebviewTemplate(html: string, webview: vscode.Webview): string {
    const nonce = getNonce();
    return html
        .replace(/{{\s*CSP_SOURCE\s*}}/g, webview.cspSource)
        .replace(/{{\s*NONCE\s*}}/g, nonce);
}

/** Serializes a value to JSON, escaping `<` to prevent script injection in HTML. */
export function safeJson(val: unknown): string {
    try {
        return JSON.stringify(val).replace(/</g, '\\u003c');
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        Logger.getInstance().error(`[WebviewUtils] safeJson serialization failed: ${msg}`);
        return 'null';
    }
}

/** Replaces HTML special characters with their entity equivalents. */
export function escapeHtml(unsafe: string | undefined | null): string {
    if (!unsafe) { return ''; }
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}