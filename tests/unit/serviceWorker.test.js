import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, it, expect, vi } from 'vitest';

const SW_PATH = path.resolve('serviceWorker.js');

function createMockCache() {
	const store = new Map();
	return {
		store,
		match: vi.fn(async (req) => {
			const key = typeof req === 'string' ? req : req.url;
			return store.get(key);
		}),
		put: vi.fn(async (req, res) => {
			const key = typeof req === 'string' ? req : req.url;
			store.set(key, res);
		})
	};
}

function loadServiceWorkerInContext({
	origin = 'https://webvm.io',
	fetchImpl = vi.fn(),
	windowObj = undefined,
	navigatorObj = undefined,
	registrationObj = undefined,
	withModule = false
} = {}) {
	const code = fs.readFileSync(SW_PATH, 'utf8');
	const cacheMap = new Map();
	const listeners = new Map();
	const moduleObj = { exports: {} };

	const cachesMock = {
		open: vi.fn(async (name) => {
			if (!cacheMap.has(name)) {
				cacheMap.set(name, createMockCache());
			}
			return cacheMap.get(name);
		}),
		keys: vi.fn(async () => Array.from(cacheMap.keys())),
		delete: vi.fn(async (name) => cacheMap.delete(name))
	};

	const selfMock = {
		location: { origin },
		skipWaiting: vi.fn(async () => {}),
		clients: { claim: vi.fn(async () => {}) },
		addEventListener: vi.fn((type, fn) => {
			listeners.set(type, fn);
		}),
		...(registrationObj !== undefined ? { registration: registrationObj } : {})
	};

	const consoleMock = {
		log: vi.fn(),
		error: vi.fn(),
		warn: vi.fn()
	};

	const context = {
		self: selfMock,
		caches: cachesMock,
		fetch: fetchImpl,
		Headers,
		Response,
		Request,
		URL,
		console: consoleMock,
		setTimeout,
		clearTimeout,
		...(withModule ? { module: moduleObj, exports: moduleObj.exports } : {}),
		...(windowObj !== undefined ? { window: windowObj } : {}),
		...(navigatorObj !== undefined ? { navigator: navigatorObj } : {})
	};

	vm.runInNewContext(code, context, { filename: 'serviceWorker.js' });
	return { context, moduleExports: moduleObj.exports, selfMock, cachesMock, cacheMap, listeners, consoleMock };
}

describe('serviceWorker.js', () => {
	it('executes cleanly as a classic script in SW, browser, and CommonJS test contexts', () => {
		const swRun = loadServiceWorkerInContext();
		expect(swRun.listeners.has('install')).toBe(true);
		expect(swRun.listeners.has('activate')).toBe(true);
		expect(swRun.listeners.has('fetch')).toBe(true);

		const cjsRun = loadServiceWorkerInContext({ withModule: true });
		expect(typeof cjsRun.moduleExports.withCoiHeaders).toBe('function');
		expect(cjsRun.moduleExports.CACHE_NAME).toBe('webvm-cache-v1');

		const registerSpy = vi.fn().mockRejectedValue(new Error('Registration denied'));
		loadServiceWorkerInContext({
			windowObj: {
				crossOriginIsolated: true,
				isSecureContext: true,
				document: { currentScript: { src: 'https://webvm.io/serviceWorker.js' } },
				location: { reload: vi.fn() }
			},
			navigatorObj: {
				serviceWorker: { register: registerSpy, controller: null }
			}
		});
		expect(registerSpy).toHaveBeenCalledWith('https://webvm.io/serviceWorker.js');
	});

	it('withCoiHeaders handles undefined, opaque (status 0), 204/205/304, and redirected responses safely', () => {
		const { context } = loadServiceWorkerInContext();

		const errRes = context.withCoiHeaders(undefined);
		expect(errRes).toBeInstanceOf(Response);

		const opaque = { status: 0, type: 'opaque' };
		expect(context.withCoiHeaders(opaque)).toBe(opaque);

		for (const status of [204, 205, 304]) {
			const res = context.withCoiHeaders(new Response(null, { status }));
			expect(res.status).toBe(status);
			expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
			expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
			expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
		}

		const redirectedMock = {
			status: 200,
			statusText: 'OK',
			redirected: true,
			url: 'https://webvm.io/final',
			headers: new Headers({ 'content-type': 'text/plain' }),
			body: null
		};
		const modRedir = context.withCoiHeaders(redirectedMock);
		expect(modRedir.status).toBe(301);
		expect(modRedir.headers.get('location')).toBe('https://webvm.io/final');
		expect(modRedir.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
	});

	it('does not crash with TypeError when fetch rejects (r === undefined)', async () => {
		const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Network failure'));
		const { context } = loadServiceWorkerInContext({ fetchImpl });

		const req = new Request('https://webvm.io/_app/immutable/entry/app.js', { method: 'GET' });
		const res = await context.handleFetch(req);
		expect(res).toBeInstanceOf(Response);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('uses cache-first for /_app/immutable/* and injects COOP/COEP/CORP headers', async () => {
		const fetchImpl = vi.fn(async () => new Response('console.log(1)', { status: 200 }));
		const { context, moduleExports, cacheMap } = loadServiceWorkerInContext({ fetchImpl, withModule: true });

		const req1 = new Request('https://webvm.io/_app/immutable/chunks/chunk.js', { method: 'GET' });
		const res1 = await context.handleFetch(req1);
		expect(await res1.text()).toBe('console.log(1)');
		expect(res1.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
		expect(res1.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
		expect(res1.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(cacheMap.get(moduleExports.CACHE_NAME).store.has(req1.url)).toBe(true);

		// Second request should be served from cache without calling fetch again
		const req2 = new Request('https://webvm.io/_app/immutable/chunks/chunk.js', { method: 'GET' });
		const res2 = await context.handleFetch(req2);
		expect(await res2.text()).toBe('console.log(1)');
		expect(res2.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('uses stale-while-revalidate for static assets and network-first fallback for navigations', async () => {
		let callNum = 0;
		const fetchImpl = vi.fn(async (req) => {
			callNum++;
			if (req.url.endsWith('/assets/cheerpx.svg')) {
				return new Response(`<svg v="${callNum}"/>`, { status: 200 });
			}
			if (callNum === 3) {
				return new Response('<html>online</html>', { status: 200 });
			}
			throw new Error('offline');
		});
		const { context } = loadServiceWorkerInContext({ fetchImpl });

		// Populate static asset cache
		const assetReq = new Request('https://webvm.io/assets/cheerpx.svg', { method: 'GET' });
		const firstAsset = await context.handleFetch(assetReq);
		expect(await firstAsset.text()).toBe('<svg v="1"/>');

		// Second asset hit returns cached version immediately and triggers background refresh
		const waitPromises = [];
		const secondAsset = await context.handleFetch(assetReq, {
			waitUntil: (p) => waitPromises.push(p)
		});
		expect(await secondAsset.text()).toBe('<svg v="1"/>');
		await Promise.all(waitPromises);
		expect(fetchImpl).toHaveBeenCalledTimes(2);

		// Third fetch populates navigation cache, fourth simulates offline and falls back to cache
		const navReq = new Request('https://webvm.io/', { method: 'GET' });
		const navOnline = await context.handleFetch(navReq);
		expect(await navOnline.text()).toBe('<html>online</html>');

		const navOffline = await context.handleFetch(navReq);
		expect(await navOffline.text()).toBe('<html>online</html>');
		expect(navOffline.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
	});

	it('bypasses cache for Range requests, non-GET, cross-origin, and serviceWorker.js', async () => {
		const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
		const { context, cacheMap } = loadServiceWorkerInContext({ fetchImpl });

		await context.handleFetch(
			new Request('https://webvm.io/custom.ext2', {
				method: 'GET',
				headers: { Range: 'bytes=0-1023' }
			})
		);
		await context.handleFetch(new Request('https://webvm.io/api', { method: 'POST' }));
		await context.handleFetch(new Request('https://api.github.com/repos/leaningtech/webvm'));
		await context.handleFetch(new Request('https://webvm.io/serviceWorker.js'));

		expect(fetchImpl).toHaveBeenCalledTimes(4);
		expect(cacheMap.size).toBe(0);
	});

	it('registers SW even when crossOriginIsolated is true without reloading, and handles reject without ReferenceError', async () => {
		const reloadMock = vi.fn();
		const registerMock = vi.fn(async () => ({
			scope: '/',
			active: {},
			addEventListener: vi.fn()
		}));
		const { context } = loadServiceWorkerInContext({
			windowObj: {
				crossOriginIsolated: true,
				isSecureContext: true,
				document: { currentScript: { src: 'serviceWorker.js' } },
				location: { reload: reloadMock }
			},
			navigatorObj: {
				serviceWorker: { register: registerMock, controller: null }
			}
		});
		await new Promise((r) => setTimeout(r, 0));
		expect(registerMock).toHaveBeenCalledTimes(1);
		expect(reloadMock).not.toHaveBeenCalled();

		// Now test rejection catch(e) without ReferenceError
		const failRegister = vi.fn().mockRejectedValue(new Error('SW blocked'));
		context.navigator.serviceWorker.register = failRegister;
		await expect(context.doRegister()).resolves.toBeUndefined();
	});

	it('caches subpath /webvm/_app/immutable/* assets and handles /webvm/ and /webvm navigations under scoped deployment', async () => {
		let navAttempt = 0;
		const fetchImpl = vi.fn(async (req) => {
			if (req.url.includes('/_app/immutable/')) {
				return new Response('export const x = 1;', { status: 200 });
			}
			navAttempt++;
			if (navAttempt === 1) {
				return new Response('<html>subpath online</html>', { status: 200 });
			}
			throw new Error('offline');
		});

		const { context, moduleExports, cacheMap } = loadServiceWorkerInContext({
			origin: 'https://arjunpuninchittaya2.github.io',
			registrationObj: { scope: 'https://arjunpuninchittaya2.github.io/webvm/' },
			fetchImpl,
			withModule: true
		});

		// Immutable asset under /webvm/_app/immutable/ is cache-first with COI headers
		const assetUrl = 'https://arjunpuninchittaya2.github.io/webvm/_app/immutable/chunks/chunk.js';
		const res1 = await context.handleFetch(new Request(assetUrl, { method: 'GET' }));
		expect(await res1.text()).toBe('export const x = 1;');
		expect(res1.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
		expect(res1.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
		expect(res1.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
		expect(cacheMap.get(moduleExports.CACHE_NAME).store.has(assetUrl)).toBe(true);

		const res2 = await context.handleFetch(new Request(assetUrl, { method: 'GET' }));
		expect(await res2.text()).toBe('export const x = 1;');
		expect(fetchImpl).toHaveBeenCalledTimes(1);

		// Subpath root /webvm/ uses network-first with offline cache fallback
		const navReq = new Request('https://arjunpuninchittaya2.github.io/webvm/', { method: 'GET' });
		const navOnline = await context.handleFetch(navReq);
		expect(await navOnline.text()).toBe('<html>subpath online</html>');
		expect(navOnline.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');

		const navOffline = await context.handleFetch(navReq);
		expect(await navOffline.text()).toBe('<html>subpath online</html>');
		expect(navOffline.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');

		// Relative scope without trailing slash ('/webvm') handles both /webvm and /webvm/
		let relAttempt = 0;
		const relFetchImpl = vi.fn(async () => {
			relAttempt++;
			if (relAttempt === 1) {
				return new Response('<html>no-slash online</html>', { status: 200 });
			}
			throw new Error('offline');
		});
		const relSw = loadServiceWorkerInContext({
			origin: 'https://arjunpuninchittaya2.github.io',
			registrationObj: { scope: '/webvm' },
			fetchImpl: relFetchImpl
		});
		const noSlashReq = new Request('https://arjunpuninchittaya2.github.io/webvm', { method: 'GET' });
		const noSlashOnline = await relSw.context.handleFetch(noSlashReq);
		expect(await noSlashOnline.text()).toBe('<html>no-slash online</html>');
		const noSlashOffline = await relSw.context.handleFetch(noSlashReq);
		expect(await noSlashOffline.text()).toBe('<html>no-slash online</html>');
		expect(noSlashOffline.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
	});

	it('bypasses CacheStorage for GitHub split .ext2 chunks and .meta files while preserving COOP/COEP/CORP headers', async () => {
		const fetchImpl = vi.fn(async (req) => new Response(`body:${req.url}`, { status: 200 }));
		const { context, cachesMock, cacheMap } = loadServiceWorkerInContext({
			origin: 'https://arjunpuninchittaya2.github.io',
			registrationObj: { scope: 'https://arjunpuninchittaya2.github.io/webvm/' },
			fetchImpl
		});

		const chunkUrls = [
			'https://arjunpuninchittaya2.github.io/webvm/debian_mini.ext2.c000000.txt',
			'https://arjunpuninchittaya2.github.io/webvm/debian_mini.ext2.meta',
			'https://arjunpuninchittaya2.github.io/webvm/Debian.EXT2.C000A1F.TXT?v=2',
			'https://arjunpuninchittaya2.github.io/webvm/Debian.Ext2.Meta?cb=123'
		];

		for (const url of chunkUrls) {
			expect(context.shouldBypassCache(new Request(url, { method: 'GET' }), new URL(url))).toBe(true);
			const res = await context.handleFetch(new Request(url, { method: 'GET' }));
			expect(await res.text()).toBe(`body:${url}`);
			expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
			expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
			expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
		}

		// Repeat request must hit network again and never open or write CacheStorage
		await context.handleFetch(new Request(chunkUrls[0], { method: 'GET' }));
		expect(fetchImpl).toHaveBeenCalledTimes(5);
		expect(cachesMock.open).not.toHaveBeenCalled();
		expect(cacheMap.size).toBe(0);
	});

	it('guards doRegister() against duplicate reloads across installed -> activated statechange and active registration', async () => {
		const reloadMock = vi.fn();
		const regListeners = {};
		const installingListeners = {};
		const installingWorker = {
			state: 'installing',
			addEventListener: vi.fn((type, fn) => {
				installingListeners[type] = fn;
			})
		};
		const registration = {
			scope: 'https://arjunpuninchittaya2.github.io/webvm/',
			installing: installingWorker,
			active: null,
			addEventListener: vi.fn((type, fn) => {
				regListeners[type] = fn;
			})
		};
		const registerMock = vi.fn(async () => registration);

		loadServiceWorkerInContext({
			origin: 'https://arjunpuninchittaya2.github.io',
			windowObj: {
				crossOriginIsolated: false,
				isSecureContext: true,
				document: { currentScript: { src: 'https://arjunpuninchittaya2.github.io/webvm/serviceWorker.js' } },
				location: { reload: reloadMock }
			},
			navigatorObj: {
				serviceWorker: { register: registerMock, controller: null }
			}
		});

		await new Promise((r) => setTimeout(r, 0));
		expect(registerMock).toHaveBeenCalledTimes(1);
		expect(reloadMock).not.toHaveBeenCalled();

		// Trigger updatefound then rapid state transitions installed -> activating -> activated
		regListeners.updatefound();
		for (const nextState of ['installed', 'activating', 'activated']) {
			installingWorker.state = nextState;
			installingListeners.statechange();
		}
		expect(reloadMock).toHaveBeenCalledTimes(1);

		// Also verify case where updatefound has no installing worker AND registration.active is set
		const reloadMock2 = vi.fn();
		const regListeners2 = {};
		const registration2 = {
			scope: 'https://arjunpuninchittaya2.github.io/webvm/',
			installing: null,
			active: {},
			addEventListener: vi.fn((type, fn) => {
				regListeners2[type] = fn;
			})
		};
		loadServiceWorkerInContext({
			origin: 'https://arjunpuninchittaya2.github.io',
			windowObj: {
				crossOriginIsolated: false,
				isSecureContext: true,
				document: { currentScript: { src: 'https://arjunpuninchittaya2.github.io/webvm/serviceWorker.js' } },
				location: { reload: reloadMock2 }
			},
			navigatorObj: {
				serviceWorker: { register: vi.fn(async () => registration2), controller: null }
			}
		});
		await new Promise((r) => setTimeout(r, 0));
		expect(reloadMock2).toHaveBeenCalledTimes(1);
		regListeners2.updatefound();
		expect(reloadMock2).toHaveBeenCalledTimes(1);
	});
});
