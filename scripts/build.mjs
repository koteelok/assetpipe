import { exec } from 'child_process'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { createInterface } from 'readline'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(fileURLToPath(import.meta.url), '../..')
const packagesDir = resolve(root, 'packages')

const packages = {}
for (const dir of readdirSync(packagesDir)) {
  const pkgPath = resolve(packagesDir, dir, 'package.json')
  if (!existsSync(pkgPath)) continue
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (!pkg.scripts?.build) continue
  packages[pkg.name] = { dir, deps: Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }) }
}

const names = Object.keys(packages)
const internalNames = new Set(names)
const inDegree = Object.fromEntries(names.map((n) => [n, 0]))
const edges = Object.fromEntries(names.map((n) => [n, []]))

for (const [name, { deps }] of Object.entries(packages)) {
  for (const dep of deps) {
    if (internalNames.has(dep)) {
      edges[dep].push(name)
      inDegree[name]++
    }
  }
}

const prefix = (name) => name.replace(/^@assetpipe\//, '')

const build = (name) =>
  new Promise((resolve, reject) => {
    const tag = prefix(name)
    const proc = exec('npm run build', { cwd: `${packagesDir}/${packages[name].dir}` })
    const pipe = (stream) =>
      createInterface({ input: stream, crlfDelay: Infinity }).on('line', (line) =>
        process.stdout.write(`${tag} | ${line}\n`)
      )
    pipe(proc.stdout)
    pipe(proc.stderr)
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${name} build failed (exit ${code})`))
    )
  })

// Process wave by wave — all packages in a wave have no unbuilt dependencies
let wave = names.filter((n) => inDegree[n] === 0)
let built = 0

while (wave.length) {
  await Promise.all(wave.map(build))
  built += wave.length
  const next = []
  for (const name of wave) {
    for (const dependent of edges[name]) {
      if (--inDegree[dependent] === 0) next.push(dependent)
    }
  }
  wave = next
}

if (built !== names.length) {
  throw new Error('Circular dependency detected among packages')
}
