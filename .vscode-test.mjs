import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	coverage: {
		reporter: ['text', 'lcovonly'],
		output: 'coverage'
	}
});
