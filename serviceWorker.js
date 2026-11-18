const CACHE_NAME = "webvm-cache-v1";
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function withCoiHeaders(r) {
	if (!r) {
		return typeof Response.error === "function"
			? Response.error()
			: new Response("Service Unavailable", { status: 503 });
	}
	if (r.status === 0) {
		return r;
	}
	// We add headers to the original response its headers, in order to enable cross-origin-isolation. And make it independent of the server config.
	const newHeaders = new Headers(r.headers);
	// COEP & COOP for cross-origin-isolation.
	newHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");
	newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
	newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
	/**
	 * This workaround is necessary due to a limitation of CheerpOS, which relies on the response URL being set to the resolved URL.
	 * When constructing a new response object, the URL is not set by the Response() constructor and the serviceworker respondwith() method will set the url to event.request.url in case of an empty string.
	 * To address this, we set the location URL to the resolved response URL and set the status code to 301 in the new Response object.
	 * This causes the request to bounce back to the serviceworker from Cheerpos, with the event.request.url now set to the resolved URL, which allows the respondWith method to properly set the response URL in our new response.
	 * https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/respondWith.
	 */
	if (r.redirected === true) {
		newHeaders.set("location", r.url);
	}
	const hasNullBody = r.redirected === true || NULL_BODY_STATUSES.has(r.status);
	// In case of a redirection or null-body status, pass null body so Response constructor never throws.
	return new Response(hasNullBody ? null : r.body, {
		headers: newHeaders,
		status: r.redirected === true ? 301 : r.status,
		statusText: r.statusText,
	});
}

function isCacheable(r) {
	if (!r || !r.ok || r.status === 206 || r.redirected || r.type === "opaque") {
		return false;
	}
	const cacheControl = r.headers ? (r.headers.get("cache-control") || "") : "";
	return !cacheControl.includes("no-store");
}

function getScopePaths() {
	const rawScope =
		typeof self !== "undefined" && self.registration && self.registration.scope
			? self.registration.scope
			: "/";
	const rawOrigin = typeof self !== "undefined" && self.location && self.location.origin;
	const baseOrigin = rawOrigin && rawOrigin !== "null" ? rawOrigin : "https://localhost";
	let scopePathname = "/";
	try {
		scopePathname = new URL(rawScope, baseOrigin).pathname || "/";
	} catch {
		scopePathname = "/";
	}
	const scopeWithSlash = scopePathname.endsWith("/") ? scopePathname : `${scopePathname}/`;
	const scopeNoSlash = scopeWithSlash.length > 1 ? scopeWithSlash.slice(0, -1) : scopeWithSlash;
	return { scopeWithSlash, scopeNoSlash };
}

function shouldBypassCache(request, url) {
	if (request.method !== "GET") return true;
	if (url.protocol !== "http:" && url.protocol !== "https:") return true;
	if (request.headers && request.headers.has("range")) return true;
	const origin = typeof self !== "undefined" && self.location ? self.location.origin : url.origin;
	if (url.origin !== origin) return true;
	if (url.pathname.endsWith("/serviceWorker.js")) return true;
	if (/\.ext2\.(?:c[0-9a-f]+\.txt|meta)$/i.test(url.pathname)) return true;
	return false;
}

async function openAppCache() {
	if (typeof caches === "undefined") return null;
	try {
		return await caches.open(CACHE_NAME);
	} catch {
		return null;
	}
}

async function safeFetch(request) {
	try {
		return await fetch(request);
	} catch (e) {
		console.error(e);
		return undefined;
	}
}

async function handleFetch(request, event) {
	let url;
	try {
		url = new URL(request.url);
	} catch {
		const r = await safeFetch(request);
		return withCoiHeaders(r);
	}

	if (shouldBypassCache(request, url)) {
		const r = await safeFetch(request);
		return withCoiHeaders(r);
	}

	const cache = await openAppCache();

	// 1. Cache-first for immutable hashed SvelteKit bundles
	if (url.pathname.includes("/_app/immutable/")) {
		if (cache) {
			const cached = await cache.match(request);
			if (cached) {
				return withCoiHeaders(cached);
			}
		}
		const r = await safeFetch(request);
		if (cache && isCacheable(r)) {
			try {
				await cache.put(request, r.clone());
			} catch {
				// Ignore cache quota errors
			}
		}
		return withCoiHeaders(r);
	}

	// 2. Network-first with cache fallback for HTML navigations
	const { scopeWithSlash, scopeNoSlash } = getScopePaths();
	const isNavigation =
		request.mode === "navigate" ||
		url.pathname === "/" ||
		url.pathname === scopeWithSlash ||
		url.pathname === scopeNoSlash ||
		url.pathname.endsWith(".html");

	if (isNavigation) {
		const r = await safeFetch(request);
		if (r) {
			if (cache && isCacheable(r)) {
				try {
					await cache.put(request, r.clone());
				} catch {
					// Ignore cache quota errors
				}
			}
			return withCoiHeaders(r);
		}
		if (cache) {
			const cached = await cache.match(request);
			if (cached) {
				return withCoiHeaders(cached);
			}
		}
		return withCoiHeaders(undefined);
	}

	// 3. Stale-while-revalidate for same-origin static assets (/assets/*, /documents/*, etc.)
	if (cache) {
		const cached = await cache.match(request);
		if (cached) {
			const refreshPromise = safeFetch(request).then(async (fresh) => {
				if (isCacheable(fresh)) {
					try {
						await cache.put(request, fresh.clone());
					} catch {
						// Ignore cache quota errors
					}
				}
			});
			if (event && typeof event.waitUntil === "function") {
				event.waitUntil(refreshPromise);
			}
			return withCoiHeaders(cached);
		}
	}

	const r = await safeFetch(request);
	if (cache && isCacheable(r)) {
		try {
			await cache.put(request, r.clone());
		} catch {
			// Ignore cache quota errors
		}
	}
	return withCoiHeaders(r);
}

function serviceWorkerInit() {
	// Init the service worker.
	self.addEventListener("install", () => self.skipWaiting());
	self.addEventListener("activate", (e) => {
		e.waitUntil(
			(async () => {
				if (typeof caches !== "undefined") {
					const keys = await caches.keys();
					await Promise.all(
						keys
							.filter((k) => k.startsWith("webvm-cache-") && k !== CACHE_NAME)
							.map((k) => caches.delete(k))
					);
				}
				await self.clients.claim();
			})()
		);
	});
	// Listen for fetch requests and call handleFetch function.
	self.addEventListener("fetch", function (e) {
		try {
			e.respondWith(handleFetch(e.request, e));
		} catch (err) {
			console.log("Serviceworker NetworkError:" + err);
		}
	});
}

async function doRegister() {
	const needsCoiReload = !window.crossOriginIsolated;
	const swUrl =
		(window.document && window.document.currentScript && window.document.currentScript.src) ||
		"serviceWorker.js";
	let reloaded = false;
	function triggerReload() {
		if (reloaded) return;
		reloaded = true;
		console.log("Reloading the page to transfer control to the Service Worker.");
		try {
			window.location.reload();
		} catch (err) {
			console.log("Service Worker failed reloading the page. ERROR:" + err);
		}
	}
	try {
		const registration = await navigator.serviceWorker.register(swUrl);
		console.log("Service Worker registered", registration.scope);
		// EventListener to make sure that the page gets reloaded when a new serviceworker gets installed.
		// Only reload if the page is not already crossOriginIsolated.
		registration.addEventListener("updatefound", () => {
			if (!needsCoiReload) return;
			const installing = registration.installing;
			if (!installing) {
				triggerReload();
				return;
			}
			installing.addEventListener("statechange", () => {
				if (installing.state === "installed" || installing.state === "activated") {
					triggerReload();
				}
			});
		});
		// When the registration is active, but it's not controlling the page, we reload the page to have it take control.
		if (needsCoiReload && registration.active && !navigator.serviceWorker.controller) {
			triggerReload();
		}
	} catch (e) {
		console.error("Service Worker failed to register:", e);
	}
}

async function serviceWorkerRegister() {
	if (!window.isSecureContext) {
		console.log("Service Worker not registered, a secure context is required.");
		return;
	}
	// Register the service worker for COOP/COEP headers and offline asset caching.
	if ("serviceWorker" in navigator)
		await doRegister();
	else
		console.log("Service worker is not supported in this browser");
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		CACHE_NAME,
		getScopePaths,
		withCoiHeaders,
		isCacheable,
		shouldBypassCache,
		handleFetch,
		serviceWorkerInit,
		doRegister,
		serviceWorkerRegister,
	};
} else if (typeof window === "undefined") {
	// If the script is running in a Service Worker context
	serviceWorkerInit();
} else {
	// If the script is running in the browser context
	serviceWorkerRegister();
}
