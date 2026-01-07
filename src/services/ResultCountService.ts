import * as vscode from 'vscode';
import { FilterManager } from './FilterManager';

export class ResultCountService {

    constructor(private filterManager: FilterManager) { }

    public updateCounts(knownCounts: Map<string, number>) {
        this.applyKnownCounts(knownCounts);
    }

    private applyKnownCounts(knownCounts: Map<string, number>) {
        const groups = this.filterManager.getGroups();
        const filterCounts: { filterId: string, count: number }[] = [];
        const groupCounts: { groupId: string, count: number }[] = [];

        for (const group of groups) {
            let groupMatchCount = 0;
            for (const filter of group.filters) {
                const count = knownCounts.get(filter.id) || 0;
                filterCounts.push({ filterId: filter.id, count });
                groupMatchCount += count;
            }
            groupCounts.push({ groupId: group.id, count: groupMatchCount });
        }

        this.filterManager.updateResultCounts(filterCounts, groupCounts);
    }

    public clearCounts() {
        const groups = this.filterManager.getGroups();
        const filterCounts = groups.flatMap(g => g.filters.map(f => ({ filterId: f.id, count: 0 })));
        const groupCounts = groups.map(g => ({ groupId: g.id, count: 0 }));
        this.filterManager.updateResultCounts(filterCounts, groupCounts);
    }
}
