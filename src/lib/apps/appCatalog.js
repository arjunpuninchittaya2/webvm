import {
	WORKSPACE_MOUNT_PATH,
	detectElfArch,
	executeWorkspaceFile,
	getWorkspaceEntry,
	writeWorkspaceFile
} from '../fs/fileBridge.js';

export const APP_CATEGORIES = [
	'All',
	'Web',
	'Python',
	'Node.js',
	'C / Native',
	'Lua',
	'Utilities'
];

export const APP_CATALOG = [
	{
		id: 'web-app-starter',
		name: 'Web App Starter (HTML/CSS/JS)',
		category: 'Web',
		runtime: 'sh',
		description: 'Scaffold index.html, style.css, and app.js in workspace & serve on port 8080.',
		command: 'python3 -m http.server 8080 --directory /home/user/workspace',
		previewPort: 8080,
		tags: ['html', 'css', 'web', 'preview', 'server'],
		chromebookFriendly: true,
		starterFiles: [
			{
				path: 'index.html',
				content:
					'<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <title>WebVM App</title>\n  <link rel="stylesheet" href="style.css" />\n</head>\n<body>\n  <main class="card">\n    <h1>Hello from WebVM!</h1>\n    <p id="status">Running locally in workspace.</p>\n    <button id="btn" type="button">Click me</button>\n  </main>\n  <script src="app.js"></script>\n</body>\n</html>\n'
			},
			{
				path: 'style.css',
				content:
					'body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: grid; place-items: center; min-height: 100vh; margin: 0; }\n.card { background: #1e293b; padding: 2rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.4); text-align: center; }\nbutton { background: #38bdf8; color: #0f172a; border: 0; padding: 0.5rem 1rem; border-radius: 6px; font-weight: 600; cursor: pointer; }\n'
			},
			{
				path: 'app.js',
				content:
					'document.getElementById("btn")?.addEventListener("click", () => {\n  const el = document.getElementById("status");\n  if (el) el.textContent = "Button clicked at " + new Date().toLocaleTimeString();\n});\n'
			}
		]
	},
	{
		id: 'python-http-server',
		name: 'Python 3 HTTP Server',
		category: 'Python',
		runtime: 'python3',
		description: 'Serve /home/user/workspace over HTTP on port 8080 with minimal memory.',
		command: 'python3 -m http.server 8080 --directory /home/user/workspace',
		previewPort: 8080,
		tags: ['python', 'http', 'server', 'web'],
		chromebookFriendly: true
	},
	{
		id: 'python-repl',
		name: 'Python 3 Interactive REPL',
		category: 'Python',
		runtime: 'python3',
		description: 'Launch interactive Python 3 shell for quick scripting and math.',
		command: 'python3',
		tags: ['python', 'repl', 'script'],
		chromebookFriendly: true
	},
	{
		id: 'node-http-server',
		name: 'Node.js Micro HTTP Server',
		category: 'Node.js',
		runtime: 'node',
		description: 'Lightweight Node.js HTTP server listening on port 3000.',
		command:
			'node -e "require(\'http\').createServer((req,res)=>{res.writeHead(200,{\'Content-Type\':\'text/plain\'});res.end(\'Hello from WebVM Node!\\n\')}).listen(3000,()=>console.log(\'Listening on :3000\'))"',
		previewPort: 3000,
		tags: ['node', 'javascript', 'http', 'server'],
		chromebookFriendly: true
	},
	{
		id: 'c-hello-gcc',
		name: 'C Quick Compile & Run (gcc)',
		category: 'C / Native',
		runtime: 'gcc',
		description: 'Create hello.c in workspace, compile 32-bit i386 binary with gcc, and run.',
		command: 'gcc /home/user/workspace/hello.c -O2 -o /tmp/hello_c && /tmp/hello_c',
		tags: ['c', 'gcc', 'native', 'i386', 'compile'],
		chromebookFriendly: true,
		starterFiles: [
			{
				path: 'hello.c',
				content:
					'#include <stdio.h>\n\nint main(void) {\n    printf("Hello from 32-bit i386 WebVM!\\n");\n    return 0;\n}\n'
			}
		]
	},
	{
		id: 'lua-script-runner',
		name: 'Lua Interactive Shell',
		category: 'Lua',
		runtime: 'lua',
		description: 'Ultra-lightweight Lua interpreter ideal for low-RAM Chromebooks.',
		command: 'lua',
		tags: ['lua', 'script', 'lightweight'],
		chromebookFriendly: true
	},
	{
		id: 'system-info-diag',
		name: 'System & Storage Quick Check',
		category: 'Utilities',
		runtime: 'sh',
		description: 'Print kernel architecture, memory usage, and workspace disk stats.',
		command: 'uname -a && free -m && df -h /home/user/workspace',
		tags: ['sysinfo', 'uname', 'memory', 'disk', 'busybox'],
		chromebookFriendly: true
	},
	{
		id: 'workspace-ls',
		name: 'List Workspace Contents',
		category: 'Utilities',
		runtime: 'sh',
		description: 'List all files and permissions in /home/user/workspace.',
		command: 'ls -la /home/user/workspace',
		tags: ['ls', 'files', 'workspace', 'shell'],
		chromebookFriendly: true
	}
];

/**
 * Filter catalog apps by search query and category.
 * @param {string} [query='']
 * @param {string} [category='All']
 * @returns {Array}
 */
export function filterAppCatalog(query = '', category = 'All') {
	const q = String(query || '')
		.trim()
		.toLowerCase();
	const cat = category || 'All';

	return APP_CATALOG.filter((app) => {
		if (cat !== 'All' && app.category !== cat) {
			return false;
		}
		if (!q) return true;
		const haystack = [app.name, app.description, app.category, app.runtime, ...(app.tags || [])]
			.join(' ')
			.toLowerCase();
		return haystack.includes(q);
	});
}

/**
 * Launch a curated catalog app in the VM terminal (scaffolding starter files if present).
 * @param {object} app
 * @param {object} [opts]
 * @param {object|null} [opts.vmManager]
 * @returns {Promise<{ ok: true, command: string } | { ok: false, error: string }>}
 */
export async function launchCatalogApp(appOrId, opts = {}) {
	const { vmManager = null } = opts;
	const app =
		typeof appOrId === 'string'
			? APP_CATALOG.find((item) => item.id === appOrId)
			: appOrId;
	if (!app || !app.command) {
		return { ok: false, error: 'Invalid catalog application' };
	}

	try {
		let stagedPath = null;
		if (Array.isArray(app.starterFiles)) {
			for (const sf of app.starterFiles) {
				if (!stagedPath) stagedPath = sf.path;
				const existing = getWorkspaceEntry(sf.path);
				if (!existing) {
					await writeWorkspaceFile(sf.path, sf.content, { vmManager });
				}
			}
		}

		let executed = false;
		if (vmManager?.runCommandInTerminal) {
			const vmResult = await vmManager.runCommandInTerminal(app.command, {
				title: app.name,
				cwd: WORKSPACE_MOUNT_PATH,
				newTab: Boolean(app.newTab)
			});
			executed = vmResult?.ok === true || vmResult?.status === 0 || vmResult === undefined;
		} else if (vmManager?.sendInputToActive) {
			vmManager.setActiveVt?.(1);
			vmManager.sendInputToActive(`${app.command}\r`);
			executed = true;
		}

		if (!executed) {
			return {
				ok: true,
				app,
				stagedPath,
				command: app.command,
				queued: true,
				message: `Staged & queued "${app.name}" (${app.command})`
			};
		}

		return {
			ok: true,
			app,
			stagedPath,
			command: app.command,
			queued: false,
			message: `Launched "${app.name}" (${app.command})`
		};
	} catch (err) {
		return { ok: false, error: err?.message || 'Failed to launch app' };
	}
}

/**
 * Run a workspace script or i386 ELF binary with 1 click.
 * Explicitly rejects x86_64 (and other non-i386) ELF binaries before attempting execution.
 * @param {string} filePath
 * @param {object} [opts]
 * @param {object|null} [opts.vmManager]
 * @returns {Promise<{ ok: true, command: string, entry: object } | { ok: false, error: string }>}
 */
export async function runWorkspaceBinaryOrScript(filePath, opts = {}) {
	const { vmManager = null } = opts;
	const entry = getWorkspaceEntry(filePath);
	if (!entry || entry.type !== 'file') {
		return { ok: false, error: `File not found in workspace: ${filePath}` };
	}

	const detectedArch =
		entry.elfArch || (entry.data instanceof Uint8Array ? detectElfArch(entry.data) : null);

	if (detectedArch === 'x86_64') {
		return {
			ok: false,
			error:
				'Unsupported architecture: x86_64 ELF binaries cannot run on CheerpX 32-bit i386 Linux'
		};
	}
	if (detectedArch && detectedArch !== 'i386') {
		return {
			ok: false,
			error: `Unsupported architecture: ${detectedArch} ELF binaries cannot run on CheerpX 32-bit i386 Linux`
		};
	}

	return await executeWorkspaceFile(entry.path, { vmManager });
}
