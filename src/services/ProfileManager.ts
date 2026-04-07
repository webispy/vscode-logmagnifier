import * as vscode from 'vscode';

import { Constants } from '../Constants';
import { FilterGroup } from '../models/Filter';

export interface FilterProfile {
    name: string;
    groups: FilterGroup[];
    updatedAt: number;
}

export class ProfileManager implements vscode.Disposable {
    private _onDidChangeProfile: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeProfile: vscode.Event<void> = this._onDidChangeProfile.event;

    constructor(private readonly context: vscode.ExtensionContext) { }

    /** Returns the name of the currently active filter profile. */
    public getActiveProfile(): string {
        return this.context.globalState.get<string>(Constants.GlobalState.ActiveProfile) || Constants.Labels.DefaultProfile;
    }

    /** Returns a sorted list of all profile names, always including the default profile. */
    public getProfileNames(): string[] {
        const profiles = this.context.globalState.get<FilterProfile[]>(Constants.GlobalState.FilterProfiles) || [];
        const names = profiles.map(p => p.name);
        if (!names.includes(Constants.Labels.DefaultProfile)) {
            names.unshift(Constants.Labels.DefaultProfile);
        }
        return names.sort((a, b) => {
            if (a === Constants.Labels.DefaultProfile) {
                return -1;
            }
            if (b === Constants.Labels.DefaultProfile) {
                return 1;
            }
            return a.localeCompare(b);
        });
    }

    /** Returns metadata for all profiles, including text and regex filter counts. */
    public getProfilesMetadata(): { name: string, textCount: number, regexCount: number }[] {
        const profiles = this.context.globalState.get<FilterProfile[]>(Constants.GlobalState.FilterProfiles) || [];

        // Check if Default is present
        const hasDefault = profiles.some(p => p.name === Constants.Labels.DefaultProfile);

        const metadata = profiles.map(p => {
            let textCount = 0, regexCount = 0;
            if (p.groups) {
                p.groups.forEach(g => {
                    if (g.isRegex) {
                        regexCount++;
                    } else {
                        textCount++;
                    }
                });
            }
            return { name: p.name, textCount, regexCount };
        });

        if (!hasDefault) {
            // Default profile usually has Presets (1 group)
            metadata.unshift({ name: Constants.Labels.DefaultProfile, textCount: 1, regexCount: 0 });
        }

        return metadata.sort((a, b) => {
            if (a.name === Constants.Labels.DefaultProfile) {
                return -1;
            }
            if (b.name === Constants.Labels.DefaultProfile) {
                return 1;
            }
            return a.name.localeCompare(b.name);
        });
    }

    /** Persists the given filter groups under the specified profile name. */
    public async updateProfileData(name: string, groups: FilterGroup[]) {
        // We allow saving Default Profile so it persists when switching away.

        const profiles = this.context.globalState.get<FilterProfile[]>(Constants.GlobalState.FilterProfiles) || [];
        const index = profiles.findIndex(p => p.name === name);
        if (index >= 0) {
            profiles[index].groups = groups;
            profiles[index].updatedAt = Date.now();
        } else {
            profiles.push({ name, groups, updatedAt: Date.now() });
        }
        await this.context.globalState.update(Constants.GlobalState.FilterProfiles, profiles);
    }

    /** Deletes a profile by name, switching to default if the active profile was deleted. */
    public async deleteProfile(name: string): Promise<boolean> {
        if (name === Constants.Labels.DefaultProfile) {
            return false;
        }

        let profiles = this.context.globalState.get<FilterProfile[]>(Constants.GlobalState.FilterProfiles) || [];
        const initialLen = profiles.length;
        profiles = profiles.filter(p => p.name !== name);

        if (profiles.length !== initialLen) {
            await this.context.globalState.update(Constants.GlobalState.FilterProfiles, profiles);

            // Switch to default if deleted active
            if (this.getActiveProfile() === name) {
                await this.context.globalState.update(Constants.GlobalState.ActiveProfile, Constants.Labels.DefaultProfile);
            }

            // Always fire change event when a profile is deleted
            this._onDidChangeProfile.fire();
            return true;
        }
        return false;
    }

    /** Renames a profile, returning false if the default profile is involved or the new name already exists. */
    public async renameProfile(oldName: string, newName: string): Promise<boolean> {
        if (oldName === Constants.Labels.DefaultProfile || newName === Constants.Labels.DefaultProfile) {
            return false;
        }

        const profiles = this.context.globalState.get<FilterProfile[]>(Constants.GlobalState.FilterProfiles) || [];

        // Check if new name already exists
        if (profiles.some(p => p.name === newName)) {
            return false;
        }

        const index = profiles.findIndex(p => p.name === oldName);
        if (index >= 0) {
            profiles[index].name = newName;
            profiles[index].updatedAt = Date.now();
            await this.context.globalState.update(Constants.GlobalState.FilterProfiles, profiles);

            // Update active profile if renamed
            if (this.getActiveProfile() === oldName) {
                await this.context.globalState.update(Constants.GlobalState.ActiveProfile, newName);
            }

            this._onDidChangeProfile.fire();
            return true;
        }
        return false;
    }

    /** Creates a new profile with the given name and filter groups, returning false if the name is taken. */
    public async createProfile(name: string, groupsCopy: FilterGroup[]): Promise<boolean> {
        const profiles = this.context.globalState.get<FilterProfile[]>(Constants.GlobalState.FilterProfiles) || [];
        if (profiles.some(p => p.name === name) || name === Constants.Labels.DefaultProfile) {
            return false;
        }

        const newProfile: FilterProfile = {
            name: name,
            groups: groupsCopy,
            updatedAt: Date.now()
        };
        profiles.push(newProfile);
        await this.context.globalState.update(Constants.GlobalState.FilterProfiles, profiles);
        return true;
    }

    /** Loads a profile by name, sets it as active, and returns its filter groups. */
    public async loadProfile(name: string): Promise<FilterGroup[] | undefined> {
        // Update active profile immediately if found.

        const profiles = this.context.globalState.get<FilterProfile[]>(Constants.GlobalState.FilterProfiles) || [];
        const profile = profiles.find(p => p.name === name);

        if (profile) {
            await this.context.globalState.update(Constants.GlobalState.ActiveProfile, name);
            this._onDidChangeProfile.fire();
            return profile.groups;
        }

        // If not found and it IS Default Profile, verify we switch active state anyway
        if (name === Constants.Labels.DefaultProfile) {
            await this.context.globalState.update(Constants.GlobalState.ActiveProfile, Constants.Labels.DefaultProfile);
            this._onDidChangeProfile.fire();
            return undefined; // FilterManager will init defaults
        }

        return undefined;
    }

    /** Returns the filter groups for a profile without changing the active profile. */
    public async getProfileGroups(name: string): Promise<FilterGroup[] | undefined> {
        const profiles = this.context.globalState.get<FilterProfile[]>(Constants.GlobalState.FilterProfiles) || [];

        // Handle Default Profile
        // Note: Default profile groups are not strictly stored in 'FilterProfiles' array if it relies on initialization.
        // However, ProfileManager doesn't persist Default Profile into the array unless explicitly saved?
        // Actually ProfileManager.updateProfileData handles saving Default Profile.

        const profile = profiles.find(p => p.name === name);
        if (profile) {
            return profile.groups;
        }

        // If Default Profile is requested but not in storage (e.g. never modified), we return undefined
        // The caller (WorkflowManager) should handle generating defaults if needed,
        // but Workflow likely only runs on saved explicit profiles.
        return undefined;
    }

    /** Imports a profile, optionally overwriting an existing one with the same name. */
    public async importProfile(name: string, groups: FilterGroup[], overwrite: boolean = false): Promise<boolean> {
        const profiles = this.context.globalState.get<FilterProfile[]>(Constants.GlobalState.FilterProfiles) || [];
        const exists = profiles.some(p => p.name === name);

        if (exists && !overwrite) {
            return false;
        }

        await this.updateProfileData(name, groups);
        return true;
    }

    public dispose() {
        this._onDidChangeProfile.dispose();
    }
}
