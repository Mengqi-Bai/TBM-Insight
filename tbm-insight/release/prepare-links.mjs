import { lstat, readFile, realpath, symlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

const root = await realpath(process.argv[2])
const manifest = JSON.parse(await readFile(join(root, 'runtime-links.json'), 'utf8'))

function runtimePath(value) {
  if (typeof value !== 'string' || !value.startsWith('node_modules/')) throw new Error('Invalid runtime dependency')
  const result = join(root, value)
  if (!relative(root, result).startsWith('node_modules' + sep)) throw new Error('Invalid runtime dependency')
  return result
}

const matches = (path, target) => relative(path, target) === '' && !isAbsolute(relative(root, target))
for (const [link, target] of manifest) {
  const path = runtimePath(link)
  const destination = runtimePath(target)
  if (!matches(dirname(path), await realpath(dirname(path))) || !matches(destination, await realpath(destination))) {
    throw new Error('The packaged dependency tree cannot be opened.')
  }
  const existing = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error })
  if (!existing) await symlink(destination, path, 'junction')
  else if (!existing.isSymbolicLink() || !matches(destination, await realpath(path))) {
    throw new Error('A packaged dependency was replaced. Extract TBM Insight again.')
  }
}
