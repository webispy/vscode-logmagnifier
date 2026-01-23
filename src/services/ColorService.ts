import * as vscode from 'vscode';
import { Constants } from '../constants';
import { FilterItem, FilterGroup } from '../models/Filter';

// Solarized-inspired and distinct colors for highlights
export interface ColorPreset {
    id: string; // color1 ~ color16
    dark: string;
    light: string;
}

export class ColorService {
    private colorPresets: ColorPreset[] = [];
    private colorPresetsMap: Map<string, ColorPreset> = new Map();

    constructor() {
        this.loadColorPresets();
    }

    public loadColorPresets() {
        const config = vscode.workspace.getConfiguration(Constants.Configuration.HighlightColors.Section);
        const presets: ColorPreset[] = [];

        // Load all defined color presets from configuration (package.json provides defaults)
        for (let i = 1; i <= 16; i++) {
            const id = `color${i.toString().padStart(2, '0')}`;
            const colorConfig = config.get<{ dark: string, light: string }>(id);

            if (colorConfig && colorConfig.dark && colorConfig.light) {
                presets.push({
                    id,
                    dark: colorConfig.dark,
                    light: colorConfig.light
                });
            } else {
                // Fallback to hardcoded defaults if config is missing (safety net)
                // This matches the hardcoded list I previously added, but properly formatted
                const defaults = this.getDefaultPresets();
                const def = defaults.find(p => p.id === id);
                if (def) presets.push(def);
            }
        }
        this.colorPresets = presets;

        // Rebuild cache
        this.colorPresetsMap.clear();
        for (const preset of this.colorPresets) {
            this.colorPresetsMap.set(preset.id, preset);
        }
    }

    private getDefaultPresets(): ColorPreset[] {
        return [
            { id: 'color01', dark: '#b58900', light: '#b58900' }, // Yellow
            { id: 'color02', dark: '#cb4b16', light: '#cb4b16' }, // Orange
            { id: 'color03', dark: '#dc322f', light: '#dc322f' }, // Red
            { id: 'color04', dark: '#d33682', light: '#d33682' }, // Magenta
            { id: 'color05', dark: '#6c71c4', light: '#6c71c4' }, // Violet
            { id: 'color06', dark: '#268bd2', light: '#268bd2' }, // Blue
            { id: 'color07', dark: '#2aa198', light: '#2aa198' }, // Cyan
            { id: 'color08', dark: '#859900', light: '#859900' }, // Green
            { id: 'color09', dark: '#d3a339', light: '#d3a339' }, // Light Yellow
            { id: 'color10', dark: '#e6653a', light: '#e6653a' }, // Light Orange
            { id: 'color11', dark: '#f05e5b', light: '#f05e5b' }, // Light Red
            { id: 'color12', dark: '#e86fac', light: '#e86fac' }, // Light Magenta
            { id: 'color13', dark: '#8e93db', light: '#8e93db' }, // Light Violet
            { id: 'color14', dark: '#5caae6', light: '#5caae6' }, // Light Blue
            { id: 'color15', dark: '#5bcbc1', light: '#5bcbc1' }, // Light Cyan
            { id: 'color16', dark: '#a3b830', light: '#a3b830' }  // Light Green
        ];
    }

    public getAvailableColors(): string[] {
        return this.colorPresets.map(p => p.id);
    }

    public getColorPresets(): ColorPreset[] {
        return this.colorPresets;
    }

    public getPresetById(id: string): ColorPreset | undefined {
        return this.colorPresetsMap.get(id);
    }

    public assignColor(group: FilterGroup): string {
        // Simple round-robin or hash based on group name to pick a color
        // But for new items we might want next available?
        // Current logic in original code was just picking from presets.
        // Let's implement a "next color" logic or random which is deterministic.
        // Hash code:
        let hash = 0;
        for (let i = 0; i < group.name.length; i++) {
            hash = group.name.charCodeAt(i) + ((hash << 5) - hash);
        }
        const index = Math.abs(hash) % this.colorPresets.length;
        return this.colorPresets[index].id;
    }
}
