export type RunbookItemKind = "group" | "markdown";

export interface RunbookItemBase {
    id: string;
    kind: RunbookItemKind;
    label: string;
}

export interface RunbookMarkdown extends RunbookItemBase {
    type: "markdown";
    kind: "markdown";
    filePath: string;
}

export interface RunbookGroup extends RunbookItemBase {
    type: "group";
    kind: "group";
    dirPath: string;
    children: RunbookItem[];
}

export type RunbookItem = RunbookGroup | RunbookMarkdown;
