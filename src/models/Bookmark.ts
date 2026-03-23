import * as vscode from 'vscode';

/** A single bookmarked line in an editor document. */
export interface BookmarkItem {
    id: string; // Unique ID for the bookmark
    uri: vscode.Uri;
    line: number;
    content: string;
    groupId: string; // ID for the addition group
    matchText?: string; // The text that was matched or selected
}

/** Result of a bookmark add/remove operation. */
export interface BookmarkResult {
    success: boolean;
    message?: string;
}
