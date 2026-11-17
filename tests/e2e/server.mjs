import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BUILD_DIR = path.resolve(__dirname, '../../build');

const MIME_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.mjs': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.wasm': 'application/wasm',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.ico': 'image/x-icon',
	'.webp': 'image/webp',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.pdf': 'application/pdf',
	'.txt': 'text/plain; charset=utf-8',
	'.list': 'text/plain; charset=utf-8'
};

export const COI_HEADERS = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
	'Cross-Origin-Resource-Policy': 'cross-origin'
};

export function startServer({
	rootDir = DEFAULT_BUILD_DIR,
	host = '127.0.0.1',
	port = 0,
	withCoiHeaders = true
} = {}) {
	const resolvedRoot = path.resolve(rootDir);

	const server = http.createServer((req, res) => {
		try {
			const reqUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
			let pathname = decodeURIComponent(reqUrl.pathname);
			if (pathname === '/') {
				pathname = '/index.html';
			}

			// Normalize and prevent directory traversal outside resolvedRoot
			const safeRel = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
			let filePath = path.join(resolvedRoot, safeRel);

			if (!filePath.startsWith(resolvedRoot)) {
				res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
				res.end('Forbidden');
				return;
			}

			if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
				filePath = path.join(filePath, 'index.html');
			}

			// Fallback to index.html for SPA routes without file extension
			if (!fs.existsSync(filePath) && !path.extname(filePath)) {
				const htmlCandidate = filePath + '.html';
				if (fs.existsSync(htmlCandidate) && fs.statSync(htmlCandidate).isFile()) {
					filePath = htmlCandidate;
				} else {
					filePath = path.join(resolvedRoot, 'index.html');
				}
			}

			if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
				const headers = {
					'Content-Type': 'text/plain; charset=utf-8',
					...(withCoiHeaders ? COI_HEADERS : {})
				};
				res.writeHead(404, headers);
				res.end('Not Found');
				return;
			}

			const ext = path.extname(filePath).toLowerCase();
			const contentType = MIME_TYPES[ext] || 'application/octet-stream';
			const headers = {
				'Content-Type': contentType,
				'Cache-Control': 'no-store',
				...(withCoiHeaders ? COI_HEADERS : {})
			};

			res.writeHead(200, headers);
			if (req.method === 'HEAD') {
				res.end();
				return;
			}
			fs.createReadStream(filePath).pipe(res);
		} catch (err) {
			res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end(`Server Error: ${err.message}`);
		}
	});

	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, host, () => {
			const addr = server.address();
			const boundPort = typeof addr === 'object' && addr ? addr.port : port;
			resolve({
				server,
				host,
				port: boundPort,
				url: `http://${host}:${boundPort}`,
				close: () =>
					new Promise((resClose, rejClose) => {
						server.close((err) => (err ? rejClose(err) : resClose()));
					})
			});
		});
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const port = Number(process.env.PORT || 8081);
	const host = process.env.HOST || '127.0.0.1';
	startServer({ host, port })
		.then(({ url }) => {
			console.log(`WebVM static preview server listening at ${url} (COOP/COEP/CORP enabled)`);
		})
		.catch((err) => {
			console.error('Failed to start preview server:', err);
			process.exit(1);
		});
}
