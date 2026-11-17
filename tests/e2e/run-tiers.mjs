import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';
import { launchBrowser } from './tiers/helpers.mjs';
import { tier1Tests } from './tiers/tier1-features.mjs';
import { tier2Tests } from './tiers/tier2-boundaries.mjs';
import { tier3Tests } from './tiers/tier3-combinations.mjs';
import { tier4Tests } from './tiers/tier4-scenarios.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const ALL_TESTS = [...tier1Tests, ...tier2Tests, ...tier3Tests, ...tier4Tests];

function parseArgs(argv) {
	const opts = {
		tier: 'all',
		area: null,
		milestone: null,
		id: null,
		filter: null,
		list: false,
		url: null,
		staticDir: null,
		port: 4179,
		actionTimeout: 3000,
		json: false
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => {
			if (i + 1 >= argv.length) {
				throw new Error(`Missing value for ${arg}`);
			}
			return argv[++i];
		};

		switch (arg) {
			case '--tier':
				opts.tier = next();
				break;
			case '--area':
				opts.area = next().toUpperCase();
				break;
			case '--milestone':
				opts.milestone = next().toUpperCase();
				break;
			case '--id':
				opts.id = next();
				break;
			case '--filter':
				opts.filter = next();
				break;
			case '--list':
				opts.list = true;
				break;
			case '--url':
				opts.url = next().replace(/\/+$/, '');
				break;
			case '--static-dir':
				opts.staticDir = next();
				break;
			case '--port':
				opts.port = Number(next());
				break;
			case '--action-timeout':
				opts.actionTimeout = Number(next());
				break;
			case '--json':
				opts.json = true;
				break;
			case '--help':
			case '-h':
				console.log(
					'Usage: node tests/e2e/run-tiers.mjs [--tier 1|2|3|4|all] [--area CORE|PERF|FS|APP|NET|SYS] [--milestone M1..M5] [--id <testId>] [--filter <substr>] [--list] [--url <url>] [--static-dir <dir>] [--port <num>] [--action-timeout <ms>] [--json]'
				);
				process.exit(0);
				break;
			default:
				throw new Error(`Unknown CLI flag: ${arg}`);
		}
	}

	if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
		throw new Error(`Invalid --port: ${opts.port}`);
	}
	if (opts.tier !== 'all') {
		const tokens = String(opts.tier)
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		if (tokens.length === 0 || !tokens.every((t) => ['1', '2', '3', '4'].includes(t))) {
			throw new Error(`Invalid --tier: ${opts.tier} (expected 1|2|3|4|all)`);
		}
	}
	if (!Number.isFinite(opts.actionTimeout) || opts.actionTimeout <= 0) {
		throw new Error(`Invalid --action-timeout: ${opts.actionTimeout}`);
	}
	return opts;
}

function selectTests(opts) {
	return ALL_TESTS.filter((t) => {
		if (opts.tier && opts.tier !== 'all') {
			const tiers = String(opts.tier)
				.split(',')
				.map((s) => Number(s.trim()));
			if (!tiers.includes(t.tier)) return false;
		}
		if (opts.area && t.area.toUpperCase() !== opts.area) return false;
		if (opts.milestone && t.milestone.toUpperCase() !== opts.milestone) return false;
		if (opts.id && t.id !== opts.id) return false;
		if (opts.filter) {
			const needle = opts.filter.toLowerCase();
			const hay = `${t.id} ${t.area} ${t.milestone} ${t.features.join(',')} ${t.title}`.toLowerCase();
			if (!hay.includes(needle)) return false;
		}
		return true;
	});
}

async function killProcessGroup(childOrPid, timeoutMs = 800) {
	const child = typeof childOrPid === 'object' ? childOrPid : null;
	const pid = typeof childOrPid === 'number' ? childOrPid : child?.pid;
	if (!pid) return;
	if (child && (child.exitCode !== null || child.signalCode !== null)) return;

	const sendSignal = (sig) => {
		try {
			process.kill(-pid, sig);
		} catch (err) {
			if (err?.code === 'ESRCH') {
				try {
					process.kill(pid, sig);
				} catch {
					// Already dead
				}
			}
		}
	};

	const waitExit = (ms) => {
		if (!child || child.exitCode !== null || child.signalCode !== null) {
			return Promise.resolve(true);
		}
		return new Promise((resolve) => {
			let settled = false;
			const onExit = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(true);
			};
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				child.off('exit', onExit);
				resolve(false);
			}, ms);
			child.once('exit', onExit);
		});
	};

	sendSignal('SIGTERM');
	const exited = await waitExit(timeoutMs);
	if (!exited) {
		sendSignal('SIGKILL');
		await waitExit(150);
	}
}

async function waitForServerReady(url, childProc, getOutput, timeoutMs = 30000) {
	const deadline = Date.now() + timeoutMs;
	let lastError = null;

	while (Date.now() < deadline) {
		if (childProc && childProc.exitCode !== null) {
			throw new Error(
				`Dev server exited early with code ${childProc.exitCode}.\n${getOutput()}`
			);
		}
		try {
			const res = await fetch(`${url}/`, { method: 'GET' });
			if (res.status === 200) {
				const coop = res.headers.get('cross-origin-opener-policy');
				const coep = res.headers.get('cross-origin-embedder-policy');
				if (coop !== 'same-origin' || coep !== 'require-corp') {
					throw new Error(
						`Expected COOP=same-origin and COEP=require-corp on ${url}/, got COOP=${coop}, COEP=${coep}`
					);
				}
				await res.text();
				return;
			}
			lastError = new Error(`HTTP ${res.status} on ${url}/`);
		} catch (err) {
			lastError = err;
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(`Timed out waiting for ${url}/: ${lastError?.message || 'unknown error'}\n${getOutput()}`);
}

async function probeAlpineRoute(baseUrl) {
	for (const candidate of ['/alpine.html', '/alpine']) {
		try {
			const res = await fetch(`${baseUrl}${candidate}`, { method: 'GET' });
			if (res.status === 200) {
				const html = await res.text();
				if (html.includes('alpine') || html.includes('display') || candidate === '/alpine') {
					return candidate;
				}
			}
		} catch {
			// Try next candidate
		}
	}
	return '/alpine';
}

function allocateFreePort(host = '127.0.0.1') {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.once('error', reject);
		srv.listen(0, host, () => {
			const addr = srv.address();
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			srv.close((err) => (err ? reject(err) : resolve(port)));
		});
	});
}

function startCoiProxy({ targetHost = '127.0.0.1', targetPort, listenHost = '127.0.0.1', listenPort }) {
	const proxy = http.createServer((req, res) => {
		const headers = { ...req.headers, host: `${targetHost}:${targetPort}` };
		const proxyReq = http.request(
			{
				hostname: targetHost,
				port: targetPort,
				path: req.url,
				method: req.method,
				headers
			},
			(proxyRes) => {
				const outHeaders = { ...proxyRes.headers };
				if (!outHeaders['cross-origin-opener-policy']) {
					outHeaders['cross-origin-opener-policy'] = 'same-origin';
				}
				if (!outHeaders['cross-origin-embedder-policy']) {
					outHeaders['cross-origin-embedder-policy'] = 'require-corp';
				}
				if (!outHeaders['cross-origin-resource-policy']) {
					outHeaders['cross-origin-resource-policy'] = 'cross-origin';
				}
				res.writeHead(proxyRes.statusCode || 500, outHeaders);
				proxyRes.pipe(res);
			}
		);
		proxyReq.on('error', (err) => {
			if (!res.headersSent) {
				res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
			}
			res.end(`Proxy Error: ${err.message}`);
		});
		req.pipe(proxyReq);
	});

	proxy.on('upgrade', (req, socket, head) => {
		const upstream = net.connect(targetPort, targetHost, () => {
			const rawHeaders = Object.entries(req.headers)
				.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
				.join('\r\n');
			upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${rawHeaders}\r\n\r\n`);
			if (head && head.length > 0) upstream.write(head);
			upstream.pipe(socket);
			socket.pipe(upstream);
		});
		upstream.on('error', () => socket.destroy());
		socket.on('error', () => upstream.destroy());
	});

	return new Promise((resolve, reject) => {
		proxy.once('error', reject);
		proxy.listen(listenPort, listenHost, () => {
			resolve({
				url: `http://${listenHost}:${listenPort}`,
				close: () =>
					new Promise((resClose) => {
						proxy.closeAllConnections?.();
						proxy.close(() => resClose());
					})
			});
		});
	});
}

async function main() {
	let opts;
	try {
		opts = parseArgs(process.argv.slice(2));
	} catch (err) {
		console.error(`[run-tiers] ${err.message}`);
		console.error('Run with --help for usage.');
		process.exit(1);
	}
	const selected = selectTests(opts);

	if (opts.list) {
		if (opts.json) {
			console.log(
				JSON.stringify(
					{
						total: selected.length,
						tests: selected.map(({ id, tier, area, milestone, features, title }) => ({
							id,
							tier,
							area,
							milestone,
							features,
							title
						}))
					},
					null,
					2
				)
			);
		} else {
			console.log(`Listing ${selected.length} / ${ALL_TESTS.length} tests:`);
			for (const t of selected) {
				console.log(`  [T${t.tier}][${t.area}][${t.milestone}] ${t.id} (${t.features.join(', ')}) — ${t.title}`);
			}
		}
		process.exit(0);
	}

	if (selected.length === 0) {
		console.error('No tests matched the provided filters.');
		process.exit(1);
	}

	let baseUrl = opts.url;
	let staticServer = null;
	let coiProxy = null;
	let viteChild = null;
	let browser = null;
	let cleanedUp = false;

	const cleanup = async () => {
		if (cleanedUp) return;
		cleanedUp = true;
		if (browser) {
			try {
				await browser.close();
			} catch {
				// Ignore close errors
			}
			browser = null;
		}
		if (coiProxy) {
			try {
				await coiProxy.close();
			} catch {
				// Ignore close errors
			}
			coiProxy = null;
		}
		if (staticServer) {
			try {
				staticServer.server?.closeAllConnections?.();
				await staticServer.close();
			} catch {
				// Ignore close errors
			}
			staticServer = null;
		}
		if (viteChild) {
			await killProcessGroup(viteChild);
			viteChild = null;
		}
	};

	const onSignal = (sig) => {
		cleanup().finally(() => {
			process.exit(sig === 'SIGINT' ? 130 : 143);
		});
	};
	process.once('SIGINT', onSignal);
	process.once('SIGTERM', onSignal);

	try {
		if (!baseUrl && opts.staticDir) {
			const resolvedStaticDir = path.resolve(REPO_ROOT, opts.staticDir);
			if (!fs.existsSync(resolvedStaticDir) || !fs.statSync(resolvedStaticDir).isDirectory()) {
				throw new Error(`Static directory not found: ${resolvedStaticDir}`);
			}
			staticServer = await startServer({
				rootDir: resolvedStaticDir,
				host: '127.0.0.1',
				port: opts.port,
				withCoiHeaders: true
			});
			baseUrl = staticServer.url;
			await waitForServerReady(baseUrl, null, () => '', 5000);
		} else if (!baseUrl) {
			const vitePort = await allocateFreePort('127.0.0.1');
			const logs = [];
			viteChild = spawn(
				'npx',
				['vite', 'dev', '--port', String(vitePort), '--strictPort', '--host', '127.0.0.1'],
				{
					cwd: REPO_ROOT,
					detached: true,
					stdio: ['ignore', 'pipe', 'pipe'],
					env: { ...process.env, BROWSER: 'none' }
				}
			);
			const vitePid = viteChild.pid;
			process.once('exit', () => {
				if (viteChild && viteChild.exitCode === null && viteChild.signalCode === null && vitePid) {
					try {
						process.kill(-vitePid, 'SIGKILL');
					} catch {
						try {
							process.kill(vitePid, 'SIGKILL');
						} catch {
							// Already dead
						}
					}
				}
			});
			viteChild.stdout.on('data', (chunk) => logs.push(chunk.toString()));
			viteChild.stderr.on('data', (chunk) => logs.push(chunk.toString()));

			coiProxy = await startCoiProxy({
				targetHost: '127.0.0.1',
				targetPort: vitePort,
				listenHost: '127.0.0.1',
				listenPort: opts.port
			});
			baseUrl = coiProxy.url;
			await waitForServerReady(baseUrl, viteChild, () => logs.join('').slice(-4000));
		}

		const alpineRoute = await probeAlpineRoute(baseUrl);
		// Warm up both routes once before launching tests
		await fetch(`${baseUrl}/`).then((r) => r.text()).catch(() => {});
		await fetch(`${baseUrl}${alpineRoute}`).then((r) => r.text()).catch(() => {});

		browser = await launchBrowser();

		const log = opts.json ? (...a) => console.error(...a) : (...a) => console.log(...a);
		log(`[run-tiers] Target: ${baseUrl} (alpineRoute=${alpineRoute}), tests=${selected.length}, actionTimeout=${opts.actionTimeout}ms`);

		const results = [];
		const suiteStart = Date.now();

		for (const testCase of selected) {
			if (viteChild && viteChild.exitCode !== null) {
				throw new Error(`Vite dev server exited unexpectedly with code ${viteChild.exitCode}.`);
			}
			const start = Date.now();
			try {
				await testCase.run({
					browser,
					baseUrl,
					alpineRoute,
					actionTimeout: opts.actionTimeout
				});
				const durationMs = Date.now() - start;
				results.push({
					id: testCase.id,
					tier: testCase.tier,
					area: testCase.area,
					milestone: testCase.milestone,
					features: testCase.features,
					title: testCase.title,
					status: 'PASS',
					durationMs
				});
				log(`  PASS  ${testCase.id} (${durationMs}ms) — ${testCase.title}`);
			} catch (err) {
				const durationMs = Date.now() - start;
				const errorMessage = err?.message || String(err);
				results.push({
					id: testCase.id,
					tier: testCase.tier,
					area: testCase.area,
					milestone: testCase.milestone,
					features: testCase.features,
					title: testCase.title,
					status: 'FAIL',
					durationMs,
					error: errorMessage
				});
				log(`  FAIL  ${testCase.id} (${durationMs}ms) — ${errorMessage.split('\n')[0]}`);
			}
		}

		const passed = results.filter((r) => r.status === 'PASS').length;
		const failed = results.filter((r) => r.status === 'FAIL').length;
		const executed = results.length;
		const summary = {
			baseUrl,
			alpineRoute,
			executed,
			passed,
			failed,
			durationMs: Date.now() - suiteStart,
			results
		};

		if (opts.json) {
			console.log(JSON.stringify(summary, null, 2));
		} else {
			console.log(
				`\n[run-tiers] Summary: ${passed} passed, ${failed} failed, ${executed} executed (${summary.durationMs}ms)`
			);
		}

		await cleanup();
		process.exit(failed === 0 && executed > 0 ? 0 : 1);
	} catch (err) {
		await cleanup();
		console.error('[run-tiers] FATAL:', err);
		process.exit(1);
	}
}

main().catch((err) => {
	console.error('[run-tiers] FATAL:', err);
	process.exit(1);
});
