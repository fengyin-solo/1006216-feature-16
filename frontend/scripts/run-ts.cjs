/**
 * 无第三方打包器时的 TS 直跑运行器：
 * 用 typescript 在内存里把 .ts 转成 CJS，拦截 require，支持 @/ 别名，带模块缓存
 * （同一文件必须只编译一次，保证单例 store 在所有模块间共享）。
 * 仅供 scripts/verify-bearing.ts 这类领域校验使用。
 */
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const cache = new Map()

function resolveTs(request, parent) {
  if (request.startsWith('@/')) {
    request = path.join(root, 'src', request.slice(2))
  }
  if (!request.startsWith('.') && !path.isAbsolute(request)) {
    return null
  }
  const base = path.resolve(path.dirname(parent.filename), request)
  const candidates = [base, `${base}.ts`, path.join(base, 'index.ts')]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && candidate.endsWith('.ts')) {
      return candidate
    }
  }
  return null
}

const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  const tsFile = parent ? resolveTs(request, parent) : null
  if (!tsFile) {
    return originalLoad.call(this, request, parent, isMain)
  }
  if (cache.has(tsFile)) {
    return cache.get(tsFile).exports
  }
  const source = fs.readFileSync(tsFile, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      sourceMap: false,
    },
    fileName: tsFile,
  })
  const m = new Module(tsFile, parent)
  m.filename = tsFile
  m.loaded = false
  m.paths = Module._nodeModulePaths(path.dirname(tsFile))
  cache.set(tsFile, m)
  try {
    m._compile(outputText, tsFile)
    m.loaded = true
  } catch (error) {
    cache.delete(tsFile)
    throw error
  }
  return m.exports
}

process.argv[2] = process.argv[2] || path.join(__dirname, 'verify-bearing.ts')
require(path.resolve(process.argv[2]))
