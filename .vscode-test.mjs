import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	coverage: {
		enabled: true,
		reporter: ['text', 'lcov'],
		out: 'coverage'
	}
});
