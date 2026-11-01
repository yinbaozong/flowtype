import { spawnSync } from 'node:child_process'
import electron from 'electron'
import { resolve, basename } from 'node:path'
const file = process.argv[2]
if (!file || basename(file) !== file || !/^test-|^verify-/.test(file)) throw new Error('Expected check script filename')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const result = spawnSync(electron, [resolve('scripts', file), ...process.argv.slice(3)], { encoding: 'utf8', windowsHide: true, timeout: 55000, env })
process.stdout.write(result.stdout || '')
process.stderr.write(result.stderr || '')
process.exit(result.status ?? 1)
