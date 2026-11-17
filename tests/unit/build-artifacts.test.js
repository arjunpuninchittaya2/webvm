import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const BUILD_DIR = path.resolve('build');

describe('Build artifacts & cleanup invariants', () => {
	it('removed unused legacy root xterm/ directory', () => {
		expect(fs.existsSync(path.resolve('xterm'))).toBe(false);
	});

	it('built CSS preserves .fa-robot and all UI icons while pruning unused FA glyphs', () => {
		const assetsDir = path.join(BUILD_DIR, '_app/immutable/assets');
		expect(fs.existsSync(assetsDir)).toBe(true);

		const cssFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.css'));
		expect(cssFiles.length).toBeGreaterThan(0);

		const combinedCss = cssFiles
			.map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8'))
			.join('\n');

		expect(combinedCss).toContain('.fa-robot');
		expect(combinedCss).toContain('.fa-info-circle');
		expect(combinedCss).toContain('.fa-github');
		expect(combinedCss).toContain('.fa-discord');
		expect(combinedCss).toContain('.fa-thumbtack');
		// Confirm unused FontAwesome icon bloat is pruned
		expect(combinedCss).not.toContain('.fa-hippo');
		// Confirm render-blocking Google Fonts @import is gone
		expect(combinedCss).not.toContain('fonts.googleapis.com');
	});

	it('build/assets/ contains only the 6 app-referenced assets and excludes README GIFs/screenshots', () => {
		const builtAssetsDir = path.join(BUILD_DIR, 'assets');
		expect(fs.existsSync(builtAssetsDir)).toBe(true);

		const files = fs.readdirSync(builtAssetsDir).sort();
		expect(files).toEqual([
			'cheerpx.svg',
			'discord-mark-blue.svg',
			'github-mark-white.svg',
			'social_2024.png',
			'tailscale.svg',
			'webvm_hero.png'
		]);

		expect(files).not.toContain('webvm_claude_ctf.gif');
		expect(files).not.toContain('fork_deploy_instructions.gif');
	});

	it('built HTML pages defer plausible analytics and omit Google Fonts preconnects', () => {
		for (const htmlName of ['index.html', 'alpine.html']) {
			const htmlPath = path.join(BUILD_DIR, htmlName);
			expect(fs.existsSync(htmlPath)).toBe(true);
			const html = fs.readFileSync(htmlPath, 'utf8');
			expect(html).not.toContain('fonts.googleapis.com');
			expect(html).not.toContain('fonts.gstatic.com');
			expect(html).toMatch(/<script[^>]*defer[^>]*plausible\.leaningtech\.com/);
		}
	});
});
