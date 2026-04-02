const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		const sourceWebviewsPath = path.resolve(__dirname, 'webviews');
		const targetWebviewsPath = path.resolve(__dirname, 'dist', 'webviews');
		const webviewWatchers = new Map();
		let pendingCopyTimeout = undefined;
		const copyWebviews = () => {
			if (!fs.existsSync(sourceWebviewsPath)) {
				return;
			}
			fs.mkdirSync(path.dirname(targetWebviewsPath), { recursive: true });
			fs.cpSync(sourceWebviewsPath, targetWebviewsPath, { recursive: true, force: true });
		};
		const listWebviewDirectories = (rootPath) => {
			if (!fs.existsSync(rootPath)) {
				return [];
			}

			const directories = [rootPath];
			for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
				if (!entry.isDirectory()) {
					continue;
				}
				directories.push(...listWebviewDirectories(path.join(rootPath, entry.name)));
			}
			return directories;
		};
		const scheduleWebviewCopy = () => {
			if (pendingCopyTimeout) {
				clearTimeout(pendingCopyTimeout);
			}
			pendingCopyTimeout = setTimeout(() => {
				pendingCopyTimeout = undefined;
				syncWebviewWatchers();
				copyWebviews();
				console.log('[watch] webviews copied');
			}, 50);
		};
		const syncWebviewWatchers = () => {
			if (!watch) {
				return;
			}

			const nextDirectories = new Set(listWebviewDirectories(sourceWebviewsPath));
			for (const [directoryPath, watcher] of webviewWatchers.entries()) {
				if (nextDirectories.has(directoryPath)) {
					continue;
				}
				watcher.close();
				webviewWatchers.delete(directoryPath);
			}

			for (const directoryPath of nextDirectories) {
				if (webviewWatchers.has(directoryPath)) {
					continue;
				}
				const watcher = fs.watch(directoryPath, () => {
					scheduleWebviewCopy();
				});
				webviewWatchers.set(directoryPath, watcher);
			}
		};
		const disposeWebviewWatchers = () => {
			if (pendingCopyTimeout) {
				clearTimeout(pendingCopyTimeout);
				pendingCopyTimeout = undefined;
			}
			for (const watcher of webviewWatchers.values()) {
				watcher.close();
			}
			webviewWatchers.clear();
		};

		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			if (result.errors.length === 0) {
				copyWebviews();
				syncWebviewWatchers();
			}
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
		build.onDispose(() => {
			disposeWebviewWatchers();
		});
	},
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode', 'serialport', '@serialport/*', 'node-gyp-build'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
