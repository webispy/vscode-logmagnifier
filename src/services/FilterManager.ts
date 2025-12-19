import * as vscode from 'vscode';
import { FilterGroup, FilterItem, FilterType } from '../models/Filter';

function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

export class FilterManager {
    private groups: FilterGroup[] = [];
    private _onDidChangeFilters: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeFilters: vscode.Event<void> = this._onDidChangeFilters.event;

    constructor() { }

    public getGroups(): FilterGroup[] {
        return this.groups;
    }

    public addGroup(name: string): FilterGroup {
        const newGroup: FilterGroup = {
            id: generateId(),
            name,
            filters: [],
            isEnabled: false
        };
        this.groups.push(newGroup);
        this._onDidChangeFilters.fire();
        return newGroup;
    }

    public addFilter(groupId: string, keyword: string, type: FilterType): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const newFilter: FilterItem = {
                id: generateId(),
                keyword,
                type,
                isEnabled: true
            };
            group.filters.push(newFilter);
            this._onDidChangeFilters.fire();
        }
    }

    public removeFilter(groupId: string, filterId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            group.filters = group.filters.filter(f => f.id !== filterId);
            this._onDidChangeFilters.fire();
        }
    }

    public removeGroup(groupId: string): void {
        this.groups = this.groups.filter(g => g.id !== groupId);
        this._onDidChangeFilters.fire();
    }

    public toggleGroup(groupId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            group.isEnabled = !group.isEnabled;
            this._onDidChangeFilters.fire();
        }
    }

    public toggleFilter(groupId: string, filterId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const filter = group.filters.find(f => f.id === filterId);
            if (filter) {
                filter.isEnabled = !filter.isEnabled;
                this._onDidChangeFilters.fire();
            }
        }
    }
}
