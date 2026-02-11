import * as vscode from 'vscode';
import * as fs from 'fs';
import { Constants } from '../constants';

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
                if (uri.scheme === 'file') {
                    const size = await this.getFileSizeAsync(uri);
                    const sizeMB = (size || 0) / (1024 * 1024);

                    if (sizeMB > 50) {
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
            if (uri.scheme === 'file') {
                try {
                    const stat = await vscode.workspace.fs.stat(uri);
                    return stat.size;
                } catch {
                    // Fallback to node fs if workspace fs fails (though workspace.fs is preferred)
                    if (fs.existsSync(uri.fsPath)) {
                        return fs.statSync(uri.fsPath).size;
                    }
                }
            }
        } catch (error) {
            if (onError) {
                onError(error);
            }
        }
        return undefined;
    }

    /**
     * Attempts to resolve the active text document from:
     * 1. Active Text Editor
     * 2. Visible Text Editors (first check)
     * 3. Active Tab Group (if Input is Text)
     */
    public static async resolveActiveDocument(): Promise<vscode.TextDocument | undefined> {
        let document = vscode.window.activeTextEditor?.document;

        // Check visible editors if no active editor
        if (!document) {
            const visible = vscode.window.visibleTextEditors;
            if (visible.length > 0) {
                document = visible[0].document;
            }
        }

        // Check active tab if still not found
        if (!document) {
            const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
            if (activeTab && activeTab.input instanceof vscode.TabInputText) {
                try {
                    document = await vscode.workspace.openTextDocument(activeTab.input.uri);
                } catch (e) {
                    console.error('Failed to resolve document from tab:', e);
                }
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
