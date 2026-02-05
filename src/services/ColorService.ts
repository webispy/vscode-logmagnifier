import * as vscode from 'vscode';
import { Constants } from '../constants';
import { FilterItem, FilterGroup } from '../models/Filter';

// Solarized-inspired and distinct colors for highlights
export interface ColorPreset {
    id: string; // color1 ~ color16
    dark: string;
    light: string;
}

/**
 * Service for managing highlight color presets.
 * Provides Solarized-inspired colors and manages color assignment for filter groups.
 */
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
        for (let i = 0; i <= 16; i++) {
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
                if (def) {
                    presets.push(def);
                }
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
            { id: 'color00', dark: 'rgba(0,0,0,0)', light: 'rgba(0,0,0,0)' }, // No Background (Bold only)
            { id: 'color01', dark: '#b58900', light: '#A57900' }, // Yellow (Darkened for Light)
            { id: 'color02', dark: '#cb4b16', light: '#B03B0F' }, // Orange (Darkened for Light)
            { id: 'color03', dark: '#dc322f', light: '#C01C19' }, // Red (Darkened for Light)
            { id: 'color04', dark: '#d33682', light: '#B31E6B' }, // Magenta (Darkened for Light)
            { id: 'color05', dark: '#6c71c4', light: '#5055AB' }, // Violet (Darkened for Light)
            { id: 'color06', dark: '#268bd2', light: '#1D70A8' }, // Blue (Darkened for Light)
            { id: 'color07', dark: '#2aa198', light: '#1F8C82' }, // Cyan (Darkened for Light)
            { id: 'color08', dark: '#859900', light: '#6C7D00' }, // Green (Darkened for Light)
            // Lighter variants often need to become MUCH darker to be readable on white, or just distinct.
            // Using slightly different shades
            { id: 'color09', dark: '#d3a339', light: '#9D7620' }, // Light Yellow -> Darker Gold
            { id: 'color10', dark: '#e6653a', light: '#C0461D' }, // Light Orange -> Darker Orange
            { id: 'color11', dark: '#f05e5b', light: '#D03E3B' }, // Light Red -> Darker Red
            { id: 'color12', dark: '#e86fac', light: '#C84F8C' }, // Light Magenta -> Darker Magenta
            { id: 'color13', dark: '#8e93db', light: '#6E73BB' }, // Light Violet -> Darker Violet
            { id: 'color14', dark: '#5caae6', light: '#3C8AC6' }, // Light Blue -> Darker Blue
            { id: 'color15', dark: '#5bcbc1', light: '#3BA0A1' }, // Light Cyan -> Darker Cyan
            { id: 'color16', dark: '#a3b830', light: '#839810' }  // Light Green -> Darker Green
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
        // Deterministically assign a color based on the group name's hash
        let hash = 0;
        for (let i = 0; i < group.name.length; i++) {
            hash = group.name.charCodeAt(i) + ((hash << 5) - hash);
        }
        const index = Math.abs(hash) % this.colorPresets.length;
        return this.colorPresets[index].id;
    }
}
