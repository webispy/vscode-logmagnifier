export type ShellItemKind = 'group' | 'folder' | 'command';

export interface ShellItemBase {
    id: string;
    parent?: ShellItemBase;
    kind: ShellItemKind;
    label: string;
}

export interface ShellCommand extends ShellItemBase {
    type: 'command';
    kind: 'command';
    command: string; // Raw script content
}

export interface ShellFolder extends ShellItemBase {
    type: 'folder';
    kind: 'folder';
    description?: string;
    children: (ShellFolder | ShellCommand)[];
}

export interface ShellGroup extends ShellItemBase {
    type: 'group';
    kind: 'group';
    description?: string; // Readme content
    configPath: string; // Path to the JSON file
    children: (ShellFolder)[];
}

export interface ShellConfig {
    groupName: string;
    descript?: string;
    folders: ShellFolderConfig[];
}

export interface ShellFolderConfig {
    name: string;
    descript?: string;
    folders?: ShellFolderConfig[];
    commands?: ShellCommandConfig[];
}

export interface ShellCommandConfig {
    label: string;
    command: string; // Raw script content
}

export type ShellItem = ShellGroup | ShellFolder | ShellCommand;
