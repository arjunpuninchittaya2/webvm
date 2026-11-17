import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [
		svelte({ hot: false })
	],
	resolve: {
		conditions: ['browser'],
		alias: {
			'$lib': path.resolve(__dirname, 'src/lib'),
			'$app/environment': path.resolve(__dirname, 'tests/unit/mocks/app-environment.js'),
			'$app/stores': path.resolve(__dirname, 'tests/unit/mocks/app-stores.js'),
			'$app/server': path.resolve(__dirname, 'tests/unit/mocks/app-server.js'),
			'/config_terminal': path.resolve(__dirname, 'config_public_terminal.js'),
			'/config_public_alpine': path.resolve(__dirname, 'config_public_alpine.js')
		}
	},
	test: {
		environment: 'jsdom',
		include: ['tests/unit/**/*.test.{js,mjs,ts}'],
		exclude: ['tests/e2e/**', 'node_modules/**'],
		restoreMocks: true
	}
});
