export type RunbookItemKind = "group" | "markdown";

/** Shared properties for all runbook tree nodes. */
export interface RunbookItemBase {
    id: string;
    kind: RunbookItemKind;
    label: string;
}

/** A leaf node representing a single markdown runbook file. */
export interface RunbookMarkdown extends RunbookItemBase {
    type: "markdown";
    kind: "markdown";
    filePath: string;
}

/** A directory node containing child runbook items. */
export interface RunbookGroup extends RunbookItemBase {
    type: "group";
    kind: "group";
    dirPath: string;
    children: RunbookItem[];
}

export type RunbookItem = RunbookGroup | RunbookMarkdown;
