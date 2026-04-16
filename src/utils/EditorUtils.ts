import * as fsp from 'fs/promises';

import * as vscode from 'vscode';

import { Constants } from '../Constants';

import { Logger } from '../services/Logger';

export class EditorUtils {

    /**
     * Tries to resolve the active text editor, prioritizing the active tab for large files
     * to prevent falling back to incorrect visible editors.
     *
     * @param lastActiveEditor Optional fallback if no active editor is directly found
     * @param operationName Optional name of the operation for specific error messages (e.g. "add bookmark")
     * @returns Promise resolving to the active text editor, or undefined if none found or file is too large
     */
    public static async getActiveEditorAsync(lastActiveEditor?: vscode.TextEditor, operationName: string = 'perform operation'): Promise<vscode.TextEditor | undefined> {
        let editor = vscode.window.activeTextEditor;

        if (!editor) {
            // Check for Large File (Tab API) FIRST
            // This prevents falling back to a visible editor (active elsewhere) when the user is focused on a large file tab
            const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
            if (activeTab && activeTab.input instanceof vscode.TabInputText) {
                const uri = activeTab.input.uri;
                if (uri.scheme === Constants.Schemes.File) {
                    const size = await this.getFileSizeAsync(uri);
                    const sizeMB = (size || 0) / (1024 * 1024);

                    if (sizeMB > Constants.Defaults.LargeFileSizeLimitMB) {
                        vscode.window.showErrorMessage(Constants.Messages.Error.FileTooLarge.replace('{0}', operationName));
                        return undefined;
                    }
                }
            }

            // Fallback: Last active editor
            if (lastActiveEditor && !lastActiveEditor.document.isClosed) {
                editor = lastActiveEditor;
            }
        }

        if (!editor) {
            vscode.window.showErrorMessage(Constants.Messages.Error.NoActiveEditor);
            return undefined;
        }

        return editor;
    }

    /**
     * Gets the size of a file in bytes, safely handling errors.
     * @param uri The URI of the file
     * @param onError Optional callback to handle errors
     * @returns Promise resolving to the size in bytes, or undefined if it cannot be determined
     */
    public static async getFileSizeAsync(uri: vscode.Uri, onError?: (error: unknown) => void): Promise<number | undefined> {
        try {
            if (uri.scheme === Constants.Schemes.File) {
                try {
                    const stat = await vscode.workspace.fs.stat(uri);
                    return stat.size;
                } catch (_e: unknown) {
                    // Fallback to node fs if workspace fs fails (though workspace.fs is preferred)
                    try {
                        const stat = await fsp.stat(uri.fsPath);
                        return stat.size;
                    } catch (_fallback: unknown) {
                        // File does not exist or is inaccessible
                    }
                }
            }
        } catch (e: unknown) {
            if (onError) {
                onError(e);
            }
        }
        return undefined;
    }

    /**
     * Attempts to resolve the active text document from:
     * 1. Active Text Editor
     * 2. Active Tab Group (if Input is Text) — checked before visible editors
     *    so that large files (no TextEditor) in split view are correctly identified
     * 3. Visible Text Editors (last resort fallback)
     */
    public static async resolveActiveDocument(): Promise<vscode.TextDocument | undefined> {
        let document = vscode.window.activeTextEditor?.document;

        // Reject virtual/output documents (e.g. tasks:, output:) — only file/untitled are processable
        if (document && document.uri.scheme !== Constants.Schemes.File && document.uri.scheme !== Constants.Schemes.Untitled) {
            document = undefined;
        }

        // Check active tab BEFORE visible editors — in split editor with large files,
        // activeTextEditor is undefined but the active tab correctly reflects user focus.
        // Falling back to visible editors first would pick the wrong (opposite) editor.
        if (!document) {
            const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
            if (activeTab && activeTab.input instanceof vscode.TabInputText) {
                const uri = activeTab.input.uri;
                if (uri.scheme === Constants.Schemes.File || uri.scheme === Constants.Schemes.Untitled) {
                    try {
                        document = await vscode.workspace.openTextDocument(uri);
                    } catch (e: unknown) {
                        Logger.getInstance().error(`[EditorUtils] Failed to resolve document from tab: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }
            }
        }

        // Last resort: check visible editors
        if (!document) {
            const visible = vscode.window.visibleTextEditors;
            const supportedEditor = visible.find(e => e.document.uri.scheme === Constants.Schemes.File || e.document.uri.scheme === Constants.Schemes.Untitled);
            if (supportedEditor) {
                document = supportedEditor.document;
            }
        }

        return document;
    }

    /**
     * Resolves URI from active tab input, even if document cannot be opened (e.g. large file, or binary).
     */
    public static resolveActiveUri(): vscode.Uri | undefined {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            return editor.document.uri;
        }

        const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (activeTab && activeTab.input instanceof vscode.TabInputText) {
            return activeTab.input.uri;
        }

        return undefined;
    }
}
