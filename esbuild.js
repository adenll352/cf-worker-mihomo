const { build } = require('esbuild');
const { cp } = require('fs/promises');
const fs = require('fs/promises');
const path = require('path');
const objectHasOwnPolyfill = require.resolve('core-js/actual/object/has-own');
const replaceOpenApiIsNode = {
    name: 'replace-open-api-is-node',
    setup(build) {
        build.onLoad(
            {
                filter: /open-api\.js$/,
            },
            async (args) => {
                let contents = await fs.readFile(args.path, 'utf8');

                if (args.path.includes(path.join('src', 'core', 'Sub-Store', 'backend', 'src', 'vendor'))) {
                    contents = contents.replace(/const\s+isNode\s*=\s*eval\(`typeof process !== "undefined"`\)\s*;/, 'const isNode = false;');
                }

                return {
                    contents,
                    loader: 'js',
                };
            },
        );
    },
};

// Plugin to provide virtual stub modules for Node builtins when bundling for browser/worker.
// This prevents esbuild "Could not resolve 'fs'" errors while ensuring imports resolve to a harmless stub.
const stubNodeBuiltins = {
    name: 'stub-node-builtins',
    setup(build) {
        const builtins = ['fs', 'net', 'tls', 'dgram', 'child_process', 'stream/promises'];
        // Escape slashes for regex
        const escaped = builtins.map((s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
        const filter = new RegExp(`^(${escaped})$`);

        // Resolve these builtin names into a virtual namespace
        build.onResolve({ filter }, (args) => {
            return { path: args.path, namespace: 'node-builtins-stub' };
        });

        // Provide a small safe stub for the virtual modules
        build.onLoad({ filter: /.*/, namespace: 'node-builtins-stub' }, async () => {
            // Provide both ESM default export and CommonJS module.exports empty object
            const contents = `// stubbed Node builtin for worker bundle\nexports.default = {};\nmodule.exports = exports.default;\n`;
            return { contents, loader: 'js' };
        });
    },
};

!(async () => {
    const artifacts = [{ src: 'src/worker.js', dest: 'dist/_worker.js' }];
    for (const artifact of artifacts) {
        await build({
            entryPoints: [artifact.src],
            bundle: true,
            minify: true,
            sourcemap: false,
            platform: 'browser',
            format: 'esm',
            outfile: artifact.dest,
            inject: [objectHasOwnPolyPolyfillSafeguard()],
            plugins: [replaceOpenApiIsNode, stubNodeBuiltins],
            // Keep Node builtins external as an extra guard; plugin above provides virtual modules if needed.
            external: ['fs', 'net', 'tls', 'dgram', 'child_process', 'stream/promises'],
        });
        console.log(`✔️ 打包完成: ${artifact.src} → ${artifact.dest}`);
    }
    const verfacts = [{ src: 'src/vercel.js', dest: 'src/server.js' }];
    for (const artifact of verfacts) {
        await build({
            entryPoints: [artifact.src],
            bundle: true,
            minify: true,
            sourcemap: false,
            platform: 'node',
            format: 'cjs',
            outfile: artifact.dest,
            inject: [objectHasOwnPolyfill],
            plugins: [replaceOpenApiIsNode],
        });
        console.log(`✔️ 打包完成: ${artifact.src} → ${artifact.dest}`);
    }
    const copyTasks = [
        ['./template', './dist/template'],
        ['./favicon.png', './dist/favicon.png'],
        ['./icon', './dist/icon'],
    ];

    await Promise.all(copyTasks.map(([src, dest]) => cp(src, dest, { recursive: true })));
})();

function objectHasOwnPolyPolyfillSafeguard() {
    // Some environments may fail to resolve the polyfill path at module initialization.
    // Fall back to the original resolution value if defined.
    try {
        return objectHasOwnPolyfill;
    } catch (e) {
        return undefined;
    }
}
