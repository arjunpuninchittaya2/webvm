import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = path.resolve(__dirname, '../../build');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

function isExternalAssetUrl(urlString, origin) {
	try {
		const u = new URL(urlString);
		return u.origin !== origin;
	} catch {
		return false;
	}
}

async function main() {
	if (!fs.existsSync(path.join(BUILD_DIR, 'index.html'))) {
		throw new Error(`Build directory missing (${BUILD_DIR}/index.html). Run "npm run build" before E2E tests.`);
	}

	const server = await startServer({ rootDir: BUILD_DIR });
	const browser = await chromium.launch({
		executablePath: CHROMIUM_PATH,
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
	});

	try {
		for (const route of ['/', '/alpine.html']) {
			const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
			const page = await context.newPage();

			const pageErrors = [];
			const sameOriginConsoleErrors = [];
			const sameOriginHttpErrors = [];

			// Abort external third-party network calls cleanly in sandboxed/offline test runs
			await page.route('**/*', (routeHandler) => {
				const url = routeHandler.request().url();
				if (url.startsWith('http://') || url.startsWith('https://')) {
					if (isExternalAssetUrl(url, server.url)) {
						return routeHandler.abort('failed');
					}
				}
				return routeHandler.continue();
			});

			page.on('pageerror', (err) => {
				pageErrors.push(err.message || String(err));
			});

			page.on('console', (msg) => {
				if (msg.type() === 'error') {
					const loc = msg.location()?.url || '';
					const text = msg.text();
					// Ignore expected network errors from aborted external third-party calls
					if (loc && isExternalAssetUrl(loc, server.url)) return;
					if (text.includes('ERR_FAILED') && !text.includes(server.url)) return;
					sameOriginConsoleErrors.push(`${text} (${loc})`);
				}
			});

			page.on('response', (res) => {
				const url = res.url();
				if (!isExternalAssetUrl(url, server.url) && res.status() >= 400) {
					sameOriginHttpErrors.push(`${res.status()} ${url}`);
				}
			});

			await page.goto(`${server.url}${route}`, { waitUntil: 'domcontentloaded' });
			await page.waitForSelector('#console', { timeout: 10000 });
			await page.waitForSelector('.fa-robot', { timeout: 10000 });

			const isolated = await page.evaluate(() => window.crossOriginIsolated);
			assert.equal(isolated, true, `Expected window.crossOriginIsolated === true on ${route}`);

			const robotStyle = await page.evaluate(() => {
				const el = document.querySelector('.fa-robot');
				if (!el) return null;
				const before = getComputedStyle(el, '::before');
				const selfStyle = getComputedStyle(el);
				return {
					content: before.content,
					faVar: selfStyle.getPropertyValue('--fa').trim(),
					fontFamily: selfStyle.fontFamily
				};
			});
			assert.ok(robotStyle, `.fa-robot element missing on ${route}`);
			assert.ok(
				robotStyle.content && robotStyle.content !== 'none' && robotStyle.content !== 'normal',
				`.fa-robot::before computed content missing on ${route}: ${JSON.stringify(robotStyle)}`
			);

			// Exercise sidebar Information & ClaudeAI tabs on primary route
			if (route === '/') {
				await page.locator('.fa-info-circle').first().hover();
				const heroImg = page.locator('img[src="assets/webvm_hero.png"]');
				await heroImg.waitFor({ state: 'visible', timeout: 5000 });
				const heroLoaded = await heroImg.evaluate((img) => img.complete && img.naturalWidth > 0);
				assert.equal(heroLoaded, true, 'Expected assets/webvm_hero.png to load cleanly');

				await page.locator('.fa-robot').first().hover();
				await page.getByText('Claude AI Integration').waitFor({ state: 'visible', timeout: 5000 });
			}

			assert.deepEqual(pageErrors, [], `Uncaught pageerrors on ${route}: ${pageErrors.join('; ')}`);
			assert.deepEqual(
				sameOriginHttpErrors,
				[],
				`Same-origin HTTP errors on ${route}: ${sameOriginHttpErrors.join('; ')}`
			);
			assert.deepEqual(
				sameOriginConsoleErrors,
				[],
				`Same-origin console errors on ${route}: ${sameOriginConsoleErrors.join('; ')}`
			);

			await context.close();
			console.log(`[e2e] PASS ${route}: crossOriginIsolated=true, .fa-robot content=${robotStyle.content}, 0 errors`);
		}
	} finally {
		await browser.close();
		await server.close();
	}
}

main().catch((err) => {
	console.error('[e2e] FAILED:', err);
	process.exit(1);
});
