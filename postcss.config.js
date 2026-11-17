import fs from 'node:fs';
import path from 'node:path';

const BASE_FA_CLASSES = new Set([
	'fa',
	'fas',
	'fab',
	'far',
	'fa-solid',
	'fa-brands',
	'fa-regular',
	'fa-classic'
]);

const SOURCE_EXTENSIONS = new Set(['.svelte', '.js', '.ts', '.html']);

function collectUsedFaClasses(dir, outSet) {
	if (!fs.existsSync(dir)) return;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			collectUsedFaClasses(fullPath, outSet);
		} else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
			const content = fs.readFileSync(fullPath, 'utf8');
			const matches = content.match(/\bfa-[a-z0-9-]+\b/g);
			if (matches) {
				for (const cls of matches) {
					outSet.add(cls);
				}
			}
		}
	}
}

const usedFaClasses = new Set(BASE_FA_CLASSES);
collectUsedFaClasses(path.resolve('src'), usedFaClasses);

export default {
	plugins: {
		tailwindcss: {},
		autoprefixer: {},
		'postcss-discard': {
			rule: function (node, value) {
				// postcss-discard invokes rule(node, selector) per selector in rule.selectors.
				// Match either legacy `.fa-<name>:before`/`.fa-<name>::before` glyph rules
				// or FA 6+ single-declaration `--fa` custom-property glyph rules `.fa-<name>{--fa:...}`.
				const beforeMatch = value.match(/^\.fa-([a-z0-9-]+):{1,2}before$/);
				if (beforeMatch) {
					return !usedFaClasses.has(`fa-${beforeMatch[1]}`);
				}
				const isSingleFaVarDecl =
					node &&
					Array.isArray(node.nodes) &&
					node.nodes.length === 1 &&
					node.nodes[0].prop === '--fa';
				if (isSingleFaVarDecl) {
					const varMatch = value.match(/^\.fa-([a-z0-9-]+)$/);
					if (varMatch) {
						return !usedFaClasses.has(`fa-${varMatch[1]}`);
					}
				}
				return false;
			}
		}
	}
};
