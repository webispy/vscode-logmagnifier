import * as assert from 'assert';
import { ColorService } from '../../services/ColorService';
import { FilterGroup } from '../../models/Filter';

suite('ColorService Test Suite', () => {
    let service: ColorService;

    setup(() => {
        service = new ColorService();
    });

    suite('Default Presets', () => {
        test('Should load 17 color presets (color00-color16)', () => {
            const presets = service.getColorPresets();
            assert.strictEqual(presets.length, 17);
        });

        test('Should have sequential IDs from color00 to color16', () => {
            const presets = service.getColorPresets();
            for (let i = 0; i <= 16; i++) {
                const expectedId = `color${i.toString().padStart(2, '0')}`;
                assert.strictEqual(presets[i].id, expectedId);
            }
        });

        test('Each preset should have dark and light values', () => {
            const presets = service.getColorPresets();
            for (const preset of presets) {
                assert.ok(preset.dark, `${preset.id} should have a dark value`);
                assert.ok(preset.light, `${preset.id} should have a light value`);
            }
        });

        test('color00 should exist as the first preset', () => {
            const preset = service.getPresetById('color00');
            assert.ok(preset, 'color00 preset should exist');
            assert.ok(preset.dark, 'color00 should have a dark value');
            assert.ok(preset.light, 'color00 should have a light value');
        });
    });

    suite('Preset Lookup', () => {
        test('Should return preset by ID', () => {
            const preset = service.getPresetById('color05');
            assert.ok(preset);
            assert.strictEqual(preset.id, 'color05');
        });

        test('Should return undefined for unknown ID', () => {
            assert.strictEqual(service.getPresetById('color99'), undefined);
            assert.strictEqual(service.getPresetById('invalid'), undefined);
        });

        test('getAvailableColors should return all preset IDs', () => {
            const colors = service.getAvailableColors();
            assert.strictEqual(colors.length, 17);
            assert.ok(colors.includes('color00'));
            assert.ok(colors.includes('color16'));
        });
    });

    suite('Color Assignment', () => {
        test('Should deterministically assign same color for same group name', () => {
            const group: FilterGroup = { id: '1', name: 'test-group', filters: [], isEnabled: true };
            const color1 = service.assignColor(group);
            const color2 = service.assignColor(group);
            assert.strictEqual(color1, color2);
        });

        test('Should assign different colors for different group names', () => {
            const assignments = new Set<string>();
            const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon',
                'zeta', 'eta', 'theta', 'iota', 'kappa'];

            for (const name of names) {
                const group: FilterGroup = { id: name, name, filters: [], isEnabled: true };
                assignments.add(service.assignColor(group));
            }

            // With 10 distinct names and 17 presets, we should get multiple distinct colors
            assert.ok(assignments.size >= 3, `expected diverse colors, got ${assignments.size} unique out of 10`);
        });

        test('Should return a valid preset ID', () => {
            const group: FilterGroup = { id: '1', name: 'any-name', filters: [], isEnabled: true };
            const color = service.assignColor(group);
            assert.ok(service.getPresetById(color), `assigned color ${color} should be a valid preset`);
        });

        test('Should handle empty group name', () => {
            const group: FilterGroup = { id: '1', name: '', filters: [], isEnabled: true };
            const color = service.assignColor(group);
            assert.ok(color, 'should assign a color even for empty name');
        });
    });
});
