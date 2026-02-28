export type ShellItemKind = "group" | "markdown";

export interface ShellItemBase {
    id: string;
    kind: ShellItemKind;
    label: string;
}

export interface ShellMarkdown extends ShellItemBase {
    type: "markdown";
    kind: "markdown";
    filePath: string;
}

export interface ShellGroup extends ShellItemBase {
    type: "group";
    kind: "group";
    dirPath: string;
    children: ShellItem[];
}

export type ShellItem = ShellGroup | ShellMarkdown;
