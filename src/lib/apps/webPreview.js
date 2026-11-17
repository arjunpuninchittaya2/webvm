import { normalizeWorkspacePath, readWorkspaceFileText } from '../fs/fileBridge.js';

function resolveRelativePath(baseDir, ref) {
	if (!ref || /^(https?:|data:|blob:|mailto:|javascript:|#)/i.test(ref.trim())) {
		return null;
	}
	const raw = ref.trim().split('?')[0].split('#')[0].replace(/\\/g, '/');
	if (!raw) return null;

	const isRootRelative = raw.startsWith('/');
	const stack = isRootRelative || !baseDir ? [] : baseDir.split('/').filter(Boolean);
	const segments = raw.split('/');

	for (const seg of segments) {
		if (!seg || seg === '.') continue;
		if (seg === '..') {
			if (stack.length === 0) {
				// Escapes above workspace root
				return null;
			}
			stack.pop();
		} else {
			stack.push(seg);
		}
	}

	return stack.length > 0 ? stack.join('/') : null;
}

/**
 * Resolve an HTML file from the workspace for sandboxed iframe srcdoc preview,
 * inlining relative workspace CSS (<link rel="stylesheet">) and JS (<script src=...>).
 * @param {string} rawPath
 * @returns {{ ok: true, path: string, html: string, updatedAt: number } | { ok: false, error: string }}
 */
export function resolveWorkspaceHtmlPreview(rawPath) {
	let norm;
	try {
		norm = normalizeWorkspacePath(rawPath);
	} catch (err) {
		return { ok: false, error: err?.message || 'Invalid workspace path' };
	}

	if (!norm) {
		return { ok: false, error: 'File not found' };
	}

	const res = readWorkspaceFileText(norm);
	if (!res) {
		return { ok: false, error: `File not found: ${norm}` };
	}
	if (res.isBinary) {
		return { ok: false, error: `Cannot preview binary file: ${norm}` };
	}

	const baseDir = res.entry.parentDir || '';
	let html = res.text;

	// Inline relative <link rel="stylesheet" href="...">
	html = html.replace(
		/<link\b([^>]*\brel=["']stylesheet["'][^>]*)>/gi,
		(fullMatch, attrs) => {
			const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
			if (!hrefMatch) return fullMatch;
			const relPath = resolveRelativePath(baseDir, hrefMatch[1]);
			if (!relPath) return fullMatch;
			try {
				const cssFile = readWorkspaceFileText(relPath);
				if (!cssFile || cssFile.isBinary) return fullMatch;
				return `<style>\n${cssFile.text}\n</style>`;
			} catch {
				return fullMatch;
			}
		}
	);

	// Inline relative <script src="..."></script>
	html = html.replace(
		/<script\b([^>]*\bsrc=["']([^"']+)["'][^>]*)><\/script>/gi,
		(fullMatch, _attrs, src) => {
			const relPath = resolveRelativePath(baseDir, src);
			if (!relPath) return fullMatch;
			try {
				const jsFile = readWorkspaceFileText(relPath);
				if (!jsFile || jsFile.isBinary) return fullMatch;
				const safeJs = jsFile.text.replace(/<\/script>/gi, '<\\/script>');
				return `<script>\n${safeJs}\n</script>`;
			} catch {
				return fullMatch;
			}
		}
	);

	return {
		ok: true,
		path: norm,
		html,
		updatedAt: res.entry.updatedAt || Date.now()
	};
}

/**
 * Validate a TCP/UDP service port strictly as an integer in 1..65535.
 * @param {string|number} rawPort
 * @returns {{ valid: true, port: number } | { valid: false, error: string }}
 */
export function validateServicePort(rawPort) {
	const str = String(rawPort ?? '').trim();
	if (!/^\d+$/.test(str)) {
		return { valid: false, error: 'Port must be an integer between 1 and 65535' };
	}
	const port = Number(str);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		return { valid: false, error: 'Port must be an integer between 1 and 65535' };
	}
	return { valid: true, port };
}

/**
 * Build a validated local or Tailscale service preview URL.
 * @param {object} params
 * @param {string} [params.host='127.0.0.1']
 * @param {string|number} params.port
 * @param {'http'|'https'} [params.protocol='http']
 * @param {string} [params.path='/']
 * @returns {{ ok: true, url: string } | { ok: false, error: string }}
 */
export function buildServicePreviewUrl({
	host = '127.0.0.1',
	port,
	protocol = 'http',
	path = '/'
} = {}) {
	const cleanProtocol = protocol === 'https' ? 'https' : 'http';
	const cleanHost = String(host || '').trim();
	if (!cleanHost || /\s/.test(cleanHost)) {
		return { valid: false, ok: false, error: 'Host is required and cannot contain spaces' };
	}

	const portCheck = validateServicePort(port);
	if (!portCheck.valid) {
		return { ok: false, error: portCheck.error };
	}

	const rawPath = String(path || '/').trim();
	const normPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
	return {
		ok: true,
		url: `${cleanProtocol}://${cleanHost}:${portCheck.port}${normPath}`
	};
}
