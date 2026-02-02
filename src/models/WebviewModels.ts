export interface WebviewMessage {
    type: string;
    [key: string]: unknown;
}

export interface BookmarkWebviewMessage extends WebviewMessage {
    type: 'jump' | 'remove' | 'copyAll' | 'openAll' | 'collapseAll' | 'clearAll' |
    'removeGroup' | 'focusFile' | 'removeFile' | 'toggleWordWrap' |
    'mouseEnter' | 'mouseLeave' | 'toggleFold' | 'toggleLineNumbers';
    item?: SerializedBookmarkItem;
    uriString?: string;
    groupId?: string;
}

export interface SerializedBookmarkItem {
    id: string;
    line: number;
    content: string;
    uriString: string;
    groupId?: string;
    matchText?: string;
    timestamp?: number;
}
