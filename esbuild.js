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

// Enhanced plugin to stub Node builtins (including node: prefix and /promises variants)
const stubNodeBuiltins = {
    name: 'stub-node-builtins',
    setup(build) {
        const baseBuiltins = ['fs', 'net', 'tls', 'dgram', 'child_process', 'stream/promises'];
        // Build a regex to match: 'fs', 'node:fs', 'fs/promises', 'node:fs/promises', etc.
        const escaped = baseBuiltins.map((s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
        const filter = new RegExp(`^(?:node:)?(?:${escaped})$`);

        build.onResolve({ filter }, (args) => {
            // Keep the original path but put it into a virtual namespace so we can provide a safe stub.
            return { path: args.path, namespace: 'node-builtins-stub' };
        });

        build.onLoad({ filter: /.*/, namespace: 'node-builtins-stub' }, async (args) => {
            // Generate a small, safe stub tailored for common patterns.
            const name = args.path.replace(/^node:/, ''); // normalize
            let contents = `// Stubbed Node builtin: ${args.path}\n`;

            // Provide a minimal API for fs and fs/promises usage patterns
            if (name === 'fs' || name === 'node:fs') {
                contents += `const stub = {};
stub.promises = {};
stub.createReadStream = function() { throw new Error('fs.createReadStream is not supported in Cloudflare Workers'); };
stub.createWriteStream = function() { throw new Error('fs.createWriteStream is not supported in Cloudflare Workers'); };
export default stub;
module.exports = stub;
`;
            } else if (name === 'fs/promises' || name === 'node:fs/promises' || name === 'stream/promises' || name === 'node:stream/promises') {
                contents += `const stub = {};
export default stub;
module.exports = stub;
`;
            } else {
                // Generic empty stub for other builtins (net, tls, dgram, child_process)
                contents += `const stub = {};
export default stub;
module.exports = stub;
`;
            }

            return { contents, loader: 'js' };
        });
    },
};

// Helper to produce inject array only when polyfill resolves
function getInjectArray() {
    try {
        if (objectHasOwnPolyfill) return [objectHasOwnPolyfill];
    } catch (e) {
        // ignore
    }
    return [];
}

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
            inject: getInjectArray(),
            plugins: [replaceOpenApiIsNode, stubNodeBuiltins],
            // Keep Node builtins external as an extra guard; plugin provides virtual modules when needed.
            external: ['fs', 'net', 'tls', 'dgram', 'child_process', 'stream/promises', 'node:fs', 'node:stream/promises', 'node:child_process'],
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
            inject: getInjectArray(),
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
