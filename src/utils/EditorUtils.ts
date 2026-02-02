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
     * @returns The active text editor, or undefined if none found or file is too large
     */
    public static getActiveEditor(lastActiveEditor?: vscode.TextEditor, operationName: string = 'perform operation'): vscode.TextEditor | undefined {
        let editor = vscode.window.activeTextEditor;

        if (!editor) {
            // Check for Large File (Tab API) FIRST
            // This prevents falling back to a visible editor (active elsewhere) when the user is focused on a large file tab
            const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
            if (activeTab && activeTab.input instanceof vscode.TabInputText) {
                const uri = activeTab.input.uri;
                if (uri.scheme === 'file') {
                    const size = this.getFileSize(uri);
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
     * @returns The size in bytes, or undefined if it cannot be determined
     */
    public static getFileSize(uri: vscode.Uri, onError?: (error: unknown) => void): number | undefined {
        try {
            if (uri.scheme === 'file') {
                if (fs.existsSync(uri.fsPath)) {
                    return fs.statSync(uri.fsPath).size;
                }
            }
        } catch (error) {
            if (onError) {
                onError(error);
            }
        }
        return undefined;
    }
}
