import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const coiHeaders = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
	'Cross-Origin-Resource-Policy': 'cross-origin'
};

export default defineConfig({
	resolve: {
		alias: {
			'/config_terminal': process.env.WEBVM_MODE == "github" ? 'config_github_terminal.js' : 'config_public_terminal.js',
			"@leaningtech/cheerpx": process.env.CX_URL ? process.env.CX_URL : "@leaningtech/cheerpx"
		}
	},
	server: {
		headers: coiHeaders
	},
	preview: {
		headers: coiHeaders
	},
	build: {
		target: "es2022"
	},
	plugins: [
		sveltekit(),
		viteStaticCopy({
			targets: [
				{ src: 'tower.ico', dest: '' },
				{ src: 'scrollbar.css', dest: '' },
				{ src: 'serviceWorker.js', dest: '' },
				{ src: 'login.html', dest: '' },
				{ src: 'assets/cheerpx.svg', dest: 'assets' },
				{ src: 'assets/discord-mark-blue.svg', dest: 'assets' },
				{ src: 'assets/github-mark-white.svg', dest: 'assets' },
				{ src: 'assets/tailscale.svg', dest: 'assets' },
				{ src: 'assets/webvm_hero.png', dest: 'assets' },
				{ src: 'assets/social_2024.png', dest: 'assets' },
				{ src: 'documents/', dest: '' }
			]
		})
	]
});
