/** Base message type for all webview ↔ extension communication. */
export interface WebviewMessage {
    type: string;
}

/** Messages sent from the bookmark webview to the extension host. */
export interface BookmarkWebviewMessage extends WebviewMessage {
    type: 'jump' | 'remove' | 'copyAll' | 'openAll' | 'collapseAll' | 'clearAll' |
    'removeGroup' | 'focusFile' | 'removeFile' | 'toggleWordWrap' |
    'mouseEnter' | 'mouseLeave' | 'toggleFold' | 'toggleLineNumbers';
    item?: SerializedBookmarkItem;
    uriString?: string;
    groupId?: string;
}

/** JSON-safe representation of a bookmark for webview transfer. */
export interface SerializedBookmarkItem {
    id: string;
    line: number;
    content: string;
    uriString: string;
    groupId?: string;
    matchText?: string;
    timestamp?: number;
}

export type WorkflowWebviewMessage =
    | { type: 'import' }
    | { type: 'export' }
    | { type: 'run'; id: string }
    | { type: 'delete'; id: string; name: string }
    | { type: 'setActive'; id: string }
    | { type: 'clickWorkflow'; id: string }
    | { type: 'renameWorkflow'; id: string; currentName: string }
    | { type: 'openFile'; path: string }
    | { type: 'openAllResults'; id: string }
    | { type: 'closeAllResults'; id: string }
    | { type: 'addStep'; id: string; parentId?: string }
    | { type: 'removeStep'; id: string; stepId: string; name: string }
    | { type: 'openProfile'; id: string; stepId: string }
    | { type: 'moveStepUp'; id: string; stepId: string }
    | { type: 'moveStepDown'; id: string; stepId: string };
