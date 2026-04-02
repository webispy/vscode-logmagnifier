import * as assert from 'assert';
import { IconUtils } from '../../utils/IconUtils';

suite('IconUtils Test Suite', () => {
    suite('generateGroupSvg', () => {
        test('generates valid SVG without overlay', () => {
            const svg = IconUtils.generateGroupSvg('#ff0000');
            assert.ok(svg.startsWith('<svg'));
            assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
            assert.ok(svg.includes('#ff0000'));
            assert.ok(!svg.includes('mask'));
        });

        test('generates SVG with overlay when overlayColor provided', () => {
            const svg = IconUtils.generateGroupSvg('#ff0000', '#00ff00');
            assert.ok(svg.includes('mask'));
            assert.ok(svg.includes('#00ff00'));
        });

        test('sanitizes color input', () => {
            const svg = IconUtils.generateGroupSvg('<script>');
            assert.ok(!svg.includes('<script>'));
        });
    });

    suite('generateOffSvg', () => {
        test('generates SVG with OFF text', () => {
            const svg = IconUtils.generateOffSvg('#333');
            assert.ok(svg.includes('OFF'));
            assert.ok(svg.includes('#333'));
        });
    });

    suite('generateExcludeSvg', () => {
        test('generates strike-through variant by default', () => {
            const svg = IconUtils.generateExcludeSvg('#f00', '#0f0', 'line-through');
            assert.ok(svg.includes('abc'));
            assert.ok(svg.includes('line'));
        });

        test('generates dotted box for hidden style', () => {
            const svg = IconUtils.generateExcludeSvg('#f00', '#0f0', 'hidden');
            assert.ok(svg.includes('stroke-dasharray'));
            assert.ok(!svg.includes('abc'));
        });
    });

    suite('generateIncludeSvg', () => {
        test('generates circle for mode 0 (word)', () => {
            const svg = IconUtils.generateIncludeSvg('#f00', 0, 'test-id');
            assert.ok(svg.includes('circle'));
        });

        test('generates pill for mode 1 (line)', () => {
            const svg = IconUtils.generateIncludeSvg('#f00', 1, 'test-id');
            assert.ok(svg.includes('rect'));
            assert.ok(svg.includes('rx="3"'));
        });

        test('generates wide rectangle with gradient for mode 2 (full line)', () => {
            const svg = IconUtils.generateIncludeSvg('#f00', 2, 'test-id');
            assert.ok(svg.includes('linearGradient'));
        });

        test('uses stroke for transparent fill', () => {
            const svg = IconUtils.generateIncludeSvg('transparent', 0, 'test-id');
            assert.ok(svg.includes('stroke='));
            assert.ok(svg.includes('fill="none"'));
        });

        test('uses stroke for rgba(0,0,0,0)', () => {
            const svg = IconUtils.generateIncludeSvg('rgba(0,0,0,0)', 1, 'test-id');
            assert.ok(svg.includes('stroke='));
        });
    });

    suite('generateDensityBarSvg', () => {
        test('generates bars for non-empty buckets', () => {
            const svg = IconUtils.generateDensityBarSvg([5, 10, 3], 10, '#00f');
            assert.ok(svg.includes('rect'));
            assert.ok(svg.includes('#00f'));
        });

        test('returns empty SVG for empty buckets', () => {
            const svg = IconUtils.generateDensityBarSvg([], 10, '#00f');
            assert.ok(svg.includes('<svg'));
            assert.ok(!svg.includes('rect x='));
        });

        test('returns empty SVG when maxCount is 0', () => {
            const svg = IconUtils.generateDensityBarSvg([1, 2], 0, '#00f');
            assert.ok(!svg.includes('rect x='));
        });

        test('skips bars for zero-count buckets', () => {
            const svg = IconUtils.generateDensityBarSvg([0, 5, 0], 5, '#00f');
            // Should have border rect plus one data rect (for count 5)
            const rectMatches = svg.match(/rect/g) ?? [];
            // border rect + 1 data rect = 2
            assert.strictEqual(rectMatches.length, 2);
        });
    });

    suite('generateSimpleCircleSvg', () => {
        test('generates circle with specified color', () => {
            const svg = IconUtils.generateSimpleCircleSvg('#abc');
            assert.ok(svg.includes('circle'));
            assert.ok(svg.includes('#abc'));
        });
    });

    suite('generateGapSvg', () => {
        test('generates clock icon SVG', () => {
            const svg = IconUtils.generateGapSvg('#def');
            assert.ok(svg.includes('circle'));
            assert.ok(svg.includes('line'));
            assert.ok(svg.includes('#def'));
        });
    });
});
