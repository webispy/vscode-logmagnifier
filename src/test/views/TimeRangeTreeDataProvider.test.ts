import * as assert from 'assert';
import * as vscode from 'vscode';
import { TimestampService } from '../../services/TimestampService';
import { TimeRangeTreeDataProvider, TimeRangeTreeItem } from '../../views/TimeRangeTreeDataProvider';

suite('TimeRangeTreeDataProvider Test Suite', () => {
    let service: TimestampService;
    let provider: TimeRangeTreeDataProvider;

    setup(() => {
        service = new TimestampService();
        provider = new TimeRangeTreeDataProvider();
    });

    function buildIndex(lines: string[]) {
        const fmt = service.detectFormat(lines)!;
        return service.buildIndex(lines, fmt, 'test-uri');
    }

    // ── Root children ──

    suite('getChildren (root)', () => {
        test('returns empty array when no index is set', () => {
            const children = provider.getChildren() as TimeRangeTreeItem[];
            assert.strictEqual(children.length, 0);
        });

        test('returns hour-level nodes after setIndex', () => {
            const lines = [
                '03-30 09:00:00.000  1234  5678 D Tag: a',
                '03-30 10:00:00.000  1234  5678 D Tag: b',
                '03-30 11:00:00.000  1234  5678 D Tag: c',
            ];
            const index = buildIndex(lines);
            provider.setIndex(index);
            const children = provider.getChildren() as TimeRangeTreeItem[];
            assert.strictEqual(children.length, 3);
        });

        test('hour nodes are collapsible', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: a',
                '03-30 10:05:00.000  1234  5678 D Tag: b',
            ];
            const index = buildIndex(lines);
            provider.setIndex(index);
            const children = provider.getChildren() as TimeRangeTreeItem[];
            const treeItem = provider.getTreeItem(children[0]);
            assert.strictEqual(treeItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        });
    });

    // ── Children of hour node ──

    suite('getChildren (hour node)', () => {
        test('returns sub-level nodes for an hour', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: a',
                '03-30 10:05:00.000  1234  5678 D Tag: b',
                '03-30 10:15:00.000  1234  5678 D Tag: c',
            ];
            const index = buildIndex(lines);
            provider.setIndex(index);
            const hourNodes = provider.getChildren() as TimeRangeTreeItem[];
            const subNodes = provider.getChildren(hourNodes[0]) as TimeRangeTreeItem[];
            assert.ok(subNodes.length > 0, 'hour node should have sub children');
        });
    });

    // ── Children of sub node ──

    suite('getChildren (sub node)', () => {
        test('returns minute-level leaf nodes', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: a',
                '03-30 10:01:00.000  1234  5678 D Tag: b',
                '03-30 10:02:00.000  1234  5678 D Tag: c',
            ];
            const index = buildIndex(lines);
            provider.setIndex(index);
            const hourNodes = provider.getChildren() as TimeRangeTreeItem[];
            const subNodes = provider.getChildren(hourNodes[0]) as TimeRangeTreeItem[];
            const minuteNodes = provider.getChildren(subNodes[0]) as TimeRangeTreeItem[];
            assert.ok(minuteNodes.length > 0, 'sub node should have minute children');
        });

        test('minute nodes are not collapsible (leaf)', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: a',
                '03-30 10:01:00.000  1234  5678 D Tag: b',
            ];
            const index = buildIndex(lines);
            provider.setIndex(index);
            const hourNodes = provider.getChildren() as TimeRangeTreeItem[];
            const subNodes = provider.getChildren(hourNodes[0]) as TimeRangeTreeItem[];
            const minuteNodes = provider.getChildren(subNodes[0]) as TimeRangeTreeItem[];
            if (minuteNodes.length > 0) {
                const treeItem = provider.getTreeItem(minuteNodes[0]);
                assert.strictEqual(treeItem.collapsibleState, vscode.TreeItemCollapsibleState.None);
            }
        });
    });

    // ── Tree item properties ──

    suite('getTreeItem', () => {
        test('hour node label shows hour', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: a',
                '03-30 10:30:00.000  1234  5678 D Tag: b',
            ];
            const index = buildIndex(lines);
            provider.setIndex(index);
            const hourNodes = provider.getChildren() as TimeRangeTreeItem[];
            const item = provider.getTreeItem(hourNodes[0]);
            assert.ok(String(item.label).includes('10:00'), `label should contain hour, got: ${item.label}`);
        });

        test('hour node description shows line count', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: a',
                '03-30 10:30:00.000  1234  5678 D Tag: b',
                '03-30 10:45:00.000  1234  5678 D Tag: c',
            ];
            const index = buildIndex(lines);
            provider.setIndex(index);
            const hourNodes = provider.getChildren() as TimeRangeTreeItem[];
            const item = provider.getTreeItem(hourNodes[0]);
            assert.ok(String(item.description).includes('3'), `description should contain line count, got: ${item.description}`);
        });

        test('minute leaf node has command for editor jump', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: a',
                '03-30 10:01:00.000  1234  5678 D Tag: b',
            ];
            const index = buildIndex(lines);
            provider.setIndex(index);
            const hourNodes = provider.getChildren() as TimeRangeTreeItem[];
            const subNodes = provider.getChildren(hourNodes[0]) as TimeRangeTreeItem[];
            const minuteNodes = provider.getChildren(subNodes[0]) as TimeRangeTreeItem[];
            if (minuteNodes.length > 0) {
                const item = provider.getTreeItem(minuteNodes[0]);
                assert.ok(item.command, 'leaf node should have a command');
            }
        });
    });

    // ── Refresh / clear ──

    suite('setIndex / clearIndex', () => {
        test('clearIndex removes all nodes', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: a',
            ];
            const index = buildIndex(lines);
            provider.setIndex(index);
            assert.ok((provider.getChildren() as TimeRangeTreeItem[]).length > 0);
            provider.clearIndex();
            assert.strictEqual((provider.getChildren() as TimeRangeTreeItem[]).length, 0);
        });
    });
});
