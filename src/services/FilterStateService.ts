import * as vscode from 'vscode';
import { Constants } from '../constants';
import { FilterGroup, FilterItem } from '../models/Filter';

export class FilterStateService {
    constructor(private context: vscode.ExtensionContext) { }

    public saveToState(groups: FilterGroup[]) {
        this.context.globalState.update(Constants.GlobalState.FilterGroups, groups);
    }

    public loadFromState(): FilterGroup[] {
        const saved = this.context.globalState.get<FilterGroup[]>(Constants.GlobalState.FilterGroups);
        if (saved) {
            // Apply migrations if needed on load
            saved.forEach(g => {
                g.filters.forEach(f => this.ensureFilterMigration(f));
            });
            return saved;
        }
        return [];
    }

    public deepCopy<T>(obj: T): T {
        try {
            return structuredClone(obj);
        } catch (_e) {
            return JSON.parse(JSON.stringify(obj));
        }
    }

    private ensureFilterMigration(filter: FilterItem): void {
        if (filter.highlightMode === undefined) {
            interface LegacyFilterItem {
                enableFullLineHighlight?: boolean;
            }
            const legacy = filter as unknown as LegacyFilterItem;
            filter.highlightMode = legacy.enableFullLineHighlight ? 1 : 0;
            delete legacy.enableFullLineHighlight;
        }
    }
}
