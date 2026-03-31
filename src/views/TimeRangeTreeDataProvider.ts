import * as vscode from 'vscode';

import { Constants } from '../Constants';
import { TimestampIndex, TimeRangeNode } from '../models/Timestamp';
import { IconUtils } from '../utils/IconUtils';
import { ThemeUtils } from '../utils/ThemeUtils';

/** Tree item wrapping a TimeRangeNode for the Time Range Explorer view. */
export class TimeRangeTreeItem {
    constructor(
        readonly node: TimeRangeNode,
        readonly documentUri: string,
    ) {}
}

export class TimeRangeTreeDataProvider implements vscode.TreeDataProvider<TimeRangeTreeItem>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<TimeRangeTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private index: TimestampIndex | undefined;
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.disposables.push(this._onDidChangeTreeData);
    }

    /** Replace the current index and refresh the tree. */
    setIndex(index: TimestampIndex): void {
        this.index = index;
        this._onDidChangeTreeData.fire();
    }

    /** Clear the current index and refresh the tree. */
    clearIndex(): void {
        this.index = undefined;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TimeRangeTreeItem): vscode.TreeItem {
        const node = element.node;
        const pad = (n: number) => String(n).padStart(2, '0');

        const isLeaf = node.level === 'minute';
        const startHH = pad(node.startTime.getHours());

        let label: string;
        if (node.level === 'hour') {
            label = `${startHH}:00`;
        } else if (node.level === 'sub') {
            // Show the 5-minute bucket range, not actual data timestamps
            const bucketStart = Math.floor(node.startTime.getMinutes() / 5) * 5;
            const bucketEnd = bucketStart + 5;
            label = `${startHH}:${pad(bucketStart)}~${startHH}:${pad(bucketEnd)}`;
        } else {
            label = `${startHH}:${pad(node.startTime.getMinutes())}`;
        }

        const collapsibleState = isLeaf
            ? vscode.TreeItemCollapsibleState.None
            : vscode.TreeItemCollapsibleState.Collapsed;

        const item = new vscode.TreeItem(label, collapsibleState);
        item.description = `${node.lineCount} lines`;

        // Density bar icon — use full slot array so empty buckets show as gaps
        if (node.level === 'hour' && node.children && node.children.length > 0) {
            // 6 slots for 10-minute intervals (00, 10, 20, 30, 40, 50)
            const slots = new Array<number>(6).fill(0);
            for (const child of node.children) {
                const slotIdx = Math.floor(child.startTime.getMinutes() / 10);
                slots[slotIdx] += child.lineCount;
            }
            const maxCount = Math.max(...slots);
            const svg = IconUtils.generateDensityBarSvg(slots, maxCount, ThemeUtils.strokeColor);
            item.iconPath = vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
        } else if (node.level === 'sub' && node.children && node.children.length > 0) {
            // 5 slots for each minute within the 5-minute bucket
            const bucketStart = Math.floor(node.startTime.getMinutes() / 5) * 5;
            const slots = new Array<number>(5).fill(0);
            for (const child of node.children) {
                const slotIdx = child.startTime.getMinutes() - bucketStart;
                if (slotIdx >= 0 && slotIdx < 5) {
                    slots[slotIdx] = child.lineCount;
                }
            }
            const maxCount = Math.max(...slots);
            const svg = IconUtils.generateDensityBarSvg(slots, maxCount, ThemeUtils.strokeColor);
            item.iconPath = vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
        } else {
            item.iconPath = new vscode.ThemeIcon('clock');
        }

        // Tooltip with markdown table
        if (node.children && node.children.length > 0) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${label}** — ${node.lineCount} lines\n\n`);
            md.appendMarkdown('| Range | Lines |\n|-------|-------|\n');
            for (const child of node.children) {
                const cStart = `${pad(child.startTime.getHours())}:${pad(child.startTime.getMinutes())}`;
                md.appendMarkdown(`| ${cStart} | ${child.lineCount} |\n`);
            }
            item.tooltip = md;
        }

        // Leaf nodes jump to editor with flash
        if (isLeaf) {
            item.command = {
                command: Constants.Commands.TimeRangeJumpToLine,
                title: 'Go to Line',
                arguments: [node.startLine],
            };
        }

        return item;
    }

    getChildren(element?: TimeRangeTreeItem): TimeRangeTreeItem[] {
        if (!element) {
            if (!this.index) {
                return [];
            }
            return this.index.hourBuckets.map(
                node => new TimeRangeTreeItem(node, this.index!.documentUri)
            );
        }

        const children = element.node.children;
        if (!children) {
            return [];
        }
        return children.map(
            node => new TimeRangeTreeItem(node, element.documentUri)
        );
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
