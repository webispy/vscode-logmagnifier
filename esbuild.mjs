import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'es2022',
    sourcemap: !production,
    minify: production,
};

function setPackageMain(entryPoint) {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    if (pkg.main !== entryPoint) {
        pkg.main = entryPoint;
        writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    }
}

async function main() {
    if (watch) {
        const ctx = await esbuild.context(buildOptions);
        await ctx.watch();
        console.log('[esbuild] watching...');
    } else {
        await esbuild.build(buildOptions);
        if (production) {
            setPackageMain('./dist/extension.js');
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
