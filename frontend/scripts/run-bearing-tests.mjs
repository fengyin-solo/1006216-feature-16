/** 打包并运行导轴承领域测试：esbuild 解析 @ 别名，banner 注入 localStorage 垫片。 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outfile = path.join(root, 'node_modules/.bearing-test.js')

const shim = `
var __bearings = {};
globalThis.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(__bearings, k) ? __bearings[k] : null; },
  setItem: function (k, v) { __bearings[k] = String(v); },
  removeItem: function (k) { delete __bearings[k]; },
};
globalThis.addEventListener = function () {};
`

try {
  await build({
    entryPoints: [path.join(root, 'scripts/bearing-domain.test.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    alias: { '@': path.join(root, 'src') },
    banner: { js: shim },
    logLevel: 'warning',
  })
} catch (error) {
  console.error(error)
  process.exit(1)
}

await import(path.resolve(outfile))
