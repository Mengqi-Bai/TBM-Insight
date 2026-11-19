import { constants } from 'node:fs'
import { copyFile, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

async function migrateWebProfile(home) {
  const path = join(home, 'profiles', 'web', 'package.json')
  const raw = await readFile(path, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error
  })
  if (raw === undefined) return
  const manifest = JSON.parse(raw)
  if (manifest.tbm?.profile?.bundles) return

  // Match the installation-owned profile from the previous Windows ZIP.
  const names = ['base', 'web-app']
  const previous = Object.entries(manifest).find(([key, entry]) => {
    const bundles = entry?.profile?.bundles
    return manifest.name === `${key}-profile-web`
      && Array.isArray(bundles) && bundles.length === names.length
      && names.every((name, index) => bundles[index] === `@deepseek-ai/${key}-${name}`)
  })
  if (previous === undefined) return

  const [oldKey, oldValue] = previous
  const updated = {
    ...manifest,
    name: 'tbm-profile-web',
    tbm: {
      ...oldValue,
      profile: { ...oldValue.profile, bundles: names.map(name => `@tbm-insight/${name}`) },
    },
  }
  delete updated[oldKey]
  const pending = `${path}.${randomUUID()}.tmp`
  await copyFile(path, `${path}.before-package-rename`, constants.COPYFILE_EXCL).catch(error => {
    if (error.code !== 'EEXIST') throw error
  })
  try {
    await writeFile(pending, JSON.stringify(updated, null, 2) + '\n', { flag: 'wx' })
    await rename(pending, path)
  } finally {
    await rm(pending, { force: true })
  }
}

await migrateWebProfile(process.argv[2])
