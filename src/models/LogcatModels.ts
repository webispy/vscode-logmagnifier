
export interface AdbDevice {
    id: string;      // Serial number
    type: string;    // device, offline, unauthorized
    product?: string;
    model?: string;
    device?: string;
    transportId?: string;
    targetApp?: string; // Package name or 'all'
}

export interface LogcatTag {
    id: string;
    name: string;
    priority: LogPriority;
    isEnabled: boolean;
}

export enum LogPriority {
    Verbose = 'V',
    Debug = 'D',
    Info = 'I',
    Warn = 'W',
    Error = 'E',
    Fatal = 'F',
    Silent = 'S'
}

export interface LogcatSession {
    id: string;
    name: string;
    device: AdbDevice;
    tags: LogcatTag[];
    isRunning: boolean;
    outputDocumentUri?: string; // URI of the editor document
    useStartFromCurrentTime?: boolean; // If true, adds -T 1 (or equivalent) to start from now. If false, shows history.
}

// Tree Item Types
export interface TargetAppItem {
    type: 'targetApp';
    device: AdbDevice;
}

export interface SessionGroupItem {
    type: 'sessionGroup';
    device: AdbDevice;
}

export interface ControlAppItem {
    type: 'controlApp';
    device: AdbDevice;
}

export type ControlActionType = 'uninstall' | 'clearStorage' | 'clearCache';

export interface ControlActionItem {
    type: 'controlAction';
    actionType: ControlActionType;
    device: AdbDevice;
}

export type LogcatTreeItem = AdbDevice | LogcatSession | LogcatTag | TargetAppItem | SessionGroupItem | ControlAppItem | ControlActionItem;
