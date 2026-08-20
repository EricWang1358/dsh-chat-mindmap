import { existsSync, mkdirSync, rmSync, symlinkSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'

const scriptRoot = new URL('..', import.meta.url).pathname
const root = process.platform === 'win32' ? decodeURIComponent(scriptRoot).replace(/^\/(?=[A-Za-z]:)/, '') : resolve(scriptRoot)
const candidates = [
  process.env.DSH_CHECKOUT,
  join(homedir(), 'dsh-harness'),
  join(homedir(), 'dsh'),
  join(homedir(), '.dsh', 'dsh-harness'),
  'D:/Program Files/nodejs/node_global/node_modules/@deepseek-ai/dsh',
].filter(Boolean)
const checkout = candidates.find((candidate) => existsSync(join(candidate, 'packages')) || existsSync(join(candidate, 'node_modules')))
if (!checkout) throw new Error('build: set DSH_CHECKOUT to a DSH checkout or installed package root')

function link(target, source) {
  if (!existsSync(source)) return false
  rmSync(target, { recursive: true, force: true })
  mkdirSync(dirname(target), { recursive: true })
  symlinkSync(resolve(source), target, process.platform === 'win32' ? 'junction' : 'dir')
  return true
}
function linkPackage(name, relative) {
  return link(join(root, 'node_modules', name), join(checkout, relative))
}

function removeMaps(directory) {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) removeMaps(path)
    else if (entry.name.endsWith('.map')) rmSync(path, { force: true })
  }
}
removeMaps(join(root, 'lib'))

if (existsSync(join(checkout, 'packages'))) {
  linkPackage('cordis', 'vendor/cordis')
  linkPackage('@deepseek-ai/dsh-tools', 'packages/core/tools')
  linkPackage('@deepseek-ai/dsh-host-webserver', 'packages/host/webserver')
  linkPackage('@deepseek-ai/dsh-client-ui-slots', 'packages/client/ui-slots')
  linkPackage('@deepseek-ai/dsh-client-runtime', 'packages/client/runtime')
} else {
  const dshDeps = join(checkout, 'node_modules', '@deepseek-ai')
  if (existsSync(dshDeps)) {
    for (const base of readdirSync(dshDeps)) link(join(root, 'node_modules', '@deepseek-ai', base), join(dshDeps, base))
  }
  if (existsSync(join(checkout, 'node_modules', 'cordis'))) link(join(root, 'node_modules', 'cordis'), join(checkout, 'node_modules', 'cordis'))
}

const tsc = [
  join(checkout, 'node_modules', 'typescript', 'bin', 'tsc'),
  join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
].find(existsSync)
if (!tsc) throw new Error('build: TypeScript compiler not found')
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run(process.execPath, [tsc, '-p', 'tsconfig.json'])
if (existsSync(join(root, 'node_modules', 'tsdown', 'dist', 'run.mjs'))) run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:client'])
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run'])
