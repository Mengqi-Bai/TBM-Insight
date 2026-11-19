/**
 * The identity, timestamp, link, mutation, and durability-sink guarantees
 * MemoryVfs owes its consumers, asserted directly rather than through the
 * `node:fs` bridge.
 *
 * `tbm-fs-local` builds a version token from `dev:ino:size:mtimeNs:ctimeNs` and
 * refuses a write whose token moved since it read. Two properties carry that:
 * `ino` identifies the entry at a path, and `mtimeMs` moves on every write. The
 * timestamp cases freeze the clock, because these writes are in memory and two
 * revisions routinely land in the same millisecond — a real-clock test passes
 * whether or not the strict increment exists.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryVfs } from '../../src/storage/memory.ts'
import type { VfsBigIntStats, VfsMutation, VfsMutationSink, VfsStats } from '../../src/storage/types.ts'

const identity = (vfs: MemoryVfs, path: string): bigint =>
  (vfs.statSync(path, { bigint: true }) as VfsBigIntStats).ino

const linkCount = (vfs: MemoryVfs, path: string): bigint =>
  (vfs.statSync(path, { bigint: true }) as VfsBigIntStats).nlink

const modified = (vfs: MemoryVfs, path: string): number => (vfs.statSync(path) as VfsStats).mtimeMs

afterEach(() => { vi.restoreAllMocks() })

describe('entry identity', () => {
  it('distinguishes paths and holds each identity across repeated stats', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/tbm/one.txt', 'one')
    vfs.seed('/tbm/two.txt', 'two')
    const first = identity(vfs, '/tbm/one.txt')
    expect(identity(vfs, '/tbm/two.txt')).not.toBe(first)
    expect(identity(vfs, '/tbm/one.txt')).toBe(first)
  })

  it('forgets the identities under a directory removed as a subtree', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/tbm/skills/git/SKILL.md', '# git\n')
    const before = identity(vfs, '/tbm/skills/git/SKILL.md')
    vfs.rmSync('/tbm/skills', { recursive: true })
    vfs.seed('/tbm/skills/git/SKILL.md', '# git rebuilt\n')
    expect(identity(vfs, '/tbm/skills/git/SKILL.md')).not.toBe(before)
  })

  it('moves the source identity when a file replaces another path', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/tbm/from.txt', 'moved')
    vfs.seed('/tbm/to.txt', 'replaced')
    const [source, destination] = [identity(vfs, '/tbm/from.txt'), identity(vfs, '/tbm/to.txt')]
    vfs.renameSync('/tbm/from.txt', '/tbm/to.txt')
    const renamed = identity(vfs, '/tbm/to.txt')
    expect(vfs.readFileSync('/tbm/to.txt', 'utf8')).toBe('moved')
    expect([renamed === source, renamed === destination]).toEqual([true, false])
  })
})

describe('modification time', () => {
  it('hydrates explicit metadata without confusing timestamps with permission bits', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/tbm/restored', 'value', { mode: 0o600, mtimeMs: 1_600_000_000_000 })
    vfs.seedDirectory('/tbm/restored-directory', { mode: 0o700, mtimeMs: 1_600_000_000_001 })
    const stats = vfs.statSync('/tbm/restored') as VfsStats
    const directory = vfs.statSync('/tbm/restored-directory') as VfsStats
    expect([stats.mode & 0o777, stats.mtimeMs]).toEqual([0o600, 1_600_000_000_000])
    expect([directory.mode & 0o777, directory.mtimeMs]).toEqual([0o700, 1_600_000_000_001])
  })

  it('advances on every write even while the clock stands still', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const vfs = new MemoryVfs()
    vfs.seed('/tbm/log.jsonl', 'first\n')
    const seeded = modified(vfs, '/tbm/log.jsonl')
    vfs.writeFileSync('/tbm/log.jsonl', 'second\n')
    const written = modified(vfs, '/tbm/log.jsonl')
    vfs.appendFileSync('/tbm/log.jsonl', 'third\n')
    const appended = modified(vfs, '/tbm/log.jsonl')
    vfs.truncateSync('/tbm/log.jsonl', 6)
    const truncated = modified(vfs, '/tbm/log.jsonl')
    expect([written > seeded, appended > written, truncated > appended]).toEqual([true, true, true])
    // One millisecond per revision: the increment is the minimum that separates
    // two tokens, not a coarser bump that would skew a real timestamp.
    expect(truncated - seeded).toBe(3)
  })

  it('takes the clock once the clock has passed the entry', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const vfs = new MemoryVfs()
    vfs.seed('/tbm/log.jsonl', 'first\n')
    clock.mockReturnValue(1_700_000_005_000)
    vfs.writeFileSync('/tbm/log.jsonl', 'second\n')
    expect(modified(vfs, '/tbm/log.jsonl')).toBe(1_700_000_005_000)
  })

  it('extends truncation with zero bytes', async () => {
    const vfs = new MemoryVfs()
    vfs.seed('/tbm/file', new Uint8Array([1, 2]))
    vfs.truncateSync('/tbm/file', 5)
    expect([...vfs.readFileSync('/tbm/file') as Uint8Array]).toEqual([1, 2, 0, 0, 0])
    const handle = vfs.open('/tbm/file', 'r+')
    await handle.truncate(7)
    expect([...vfs.readFileSync('/tbm/file') as Uint8Array]).toEqual([1, 2, 0, 0, 0, 0, 0])
  })

  it('advances a directory only when its immediate entry set changes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/tbm/workspace')
    const empty = modified(vfs, '/tbm/workspace')
    vfs.writeFileSync('/tbm/workspace/file.txt', 'one')
    const created = modified(vfs, '/tbm/workspace')
    vfs.writeFileSync('/tbm/workspace/file.txt', 'two')
    const rewritten = modified(vfs, '/tbm/workspace')
    vfs.rmSync('/tbm/workspace/file.txt')
    const removed = modified(vfs, '/tbm/workspace')
    expect([created > empty, rewritten === created, removed > rewritten]).toEqual([true, true, true])
  })
})

describe('mutation publication', () => {
  it('publishes only committed runtime changes and keeps image seeding silent', () => {
    const vfs = new MemoryVfs()
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })
    vfs.seed('/tbm/seeded.txt', 'seeded')
    expect(mutations).toEqual([])
    vfs.writeFileSync('/tbm/seeded.txt', 'changed')
    vfs.mkdirSync('/tbm/created')
    vfs.chmodSync('/tbm/created', 0o700)
    vfs.renameSync('/tbm/seeded.txt', '/tbm/renamed.txt')
    vfs.rmSync('/tbm/created', { recursive: true })
    expect(mutations.map(mutation => ({
      kind: mutation.kind,
      path: mutation.path,
      ...mutation.kind === 'write' ? { entryChanged: mutation.entryChanged } : {},
      ...mutation.kind === 'chmod' ? { mode: mutation.mode } : {},
    }))).toEqual([
      { kind: 'write', path: '/tbm/seeded.txt', entryChanged: false },
      { kind: 'mkdir', path: '/tbm/created' },
      { kind: 'chmod', path: '/tbm/created', mode: 0o700 },
      { kind: 'remove', path: '/tbm/seeded.txt' },
      { kind: 'write', path: '/tbm/renamed.txt', entryChanged: true },
      { kind: 'remove', path: '/tbm/created' },
    ])
    const renamed = mutations[4]
    expect(renamed?.kind === 'write' && new TextDecoder().decode(renamed.bytes)).toBe('changed')
    expect(() => { vfs.writeFileSync('/missing/file', 'no') }).toThrow(/ENOENT/)
    expect(mutations).toHaveLength(6)
  })

  it('contains a faulty observer and lets disposal stop later notifications', () => {
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/tbm')
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = vfs.subscribe(() => { throw new Error('observer failed') })
    const seen: string[] = []
    const second = vfs.subscribe((mutation) => { seen.push(mutation.path) })
    vfs.writeFileSync('/tbm/one', '1')
    first()
    second()
    vfs.writeFileSync('/tbm/two', '2')
    expect(seen).toEqual(['/tbm/one'])
    expect(reported).toHaveBeenCalledOnce()
  })

  it('feeds the same complete mutations to a durable sink and live subscribers', async () => {
    const recorded: VfsMutation[] = []
    let flushes = 0
    const sink: VfsMutationSink = {
      record: (mutation) => { recorded.push(mutation) },
      flush: async () => { flushes += 1 },
    }
    const vfs = new MemoryVfs({ sink })
    vfs.seedDirectory('/tbm')
    const observed: VfsMutation[] = []
    vfs.subscribe((mutation) => { observed.push(mutation) })
    vfs.writeFileSync('/tbm/log', 'a')
    vfs.appendFileSync('/tbm/log', 'bc')
    await vfs.flush()
    expect(observed).toEqual(recorded)
    expect(observed[0]).toBe(recorded[0])
    expect(recorded[0]).toMatchObject({ kind: 'write', path: '/tbm/log', mode: 0o644, entryChanged: true })
    expect(recorded[1]).toMatchObject({ kind: 'write', path: '/tbm/log', mode: 0o644, entryChanged: false, appendedFrom: 1 })
    expect(recorded[1]?.kind === 'write' && new TextDecoder().decode(recorded[1].bytes)).toBe('abc')
    expect(flushes).toBe(1)
  })

  it('publishes descriptor writes at the file identity current path', () => {
    const mutations: VfsMutation[] = []
    const vfs = new MemoryVfs()
    vfs.seed('/tbm/source', 'old')
    const descriptor = vfs.openFileSync('/tbm/source', 'r+')
    vfs.subscribe((mutation) => { mutations.push(mutation) })
    vfs.renameSync('/tbm/source', '/tbm/destination')
    mutations.length = 0
    descriptor.write(0, new TextEncoder().encode('new'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/tbm/destination'])
    expect(vfs.readFileSync('/tbm/destination', 'utf8')).toBe('new')
    vfs.unlinkSync('/tbm/destination')
    mutations.length = 0
    descriptor.write(0, new TextEncoder().encode('detached'))
    expect(mutations).toEqual([])
    expect(new TextDecoder().decode(descriptor.read(0, descriptor.stat().size))).toBe('detached')
  })

  it('reports the path identity through a BigInt file handle stat', async () => {
    const vfs = new MemoryVfs()
    vfs.seed('/tbm/session.lock', '')
    const handle = vfs.open('/tbm/session.lock', 'w')
    const held = await handle.stat({ bigint: true }) as VfsBigIntStats
    const current = vfs.statSync('/tbm/session.lock', { bigint: true }) as VfsBigIntStats

    expect([held.dev, held.ino]).toEqual([current.dev, current.ino])
    await handle.chmod(0o600)
    expect((vfs.statSync('/tbm/session.lock') as VfsStats).mode & 0o777).toBe(0o600)
    await handle.close()
  })

  it('decomposes a directory rename into replayable destination state', () => {
    const recorded: VfsMutation[] = []
    const vfs = new MemoryVfs({
      sink: { record: (mutation) => { recorded.push(mutation) }, flush: () => Promise.resolve() },
    })
    vfs.seedDirectory('/tbm/staging/nested', { mode: 0o700 })
    vfs.seed('/tbm/staging/nested/file', 'value', { mode: 0o600 })
    vfs.renameSync('/tbm/staging', '/tbm/published')

    expect(recorded.map(mutation => [mutation.kind, mutation.path])).toEqual([
      ['remove', '/tbm/staging'],
      ['mkdir', '/tbm/published'],
      ['mkdir', '/tbm/published/nested'],
      ['write', '/tbm/published/nested/file'],
    ])
    expect(recorded[3]).toMatchObject({ kind: 'write', mode: 0o600, entryChanged: true })
    expect(recorded[3]?.kind === 'write' && new TextDecoder().decode(recorded[3].bytes)).toBe('value')
  })
})

describe('directory rename', () => {
  it('rejects file, non-empty directory, and missing-parent destinations before mutation', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/tbm/source/nested/file', 'source')
    vfs.seed('/tbm/file', 'destination')
    vfs.seed('/tbm/non-empty/child', 'destination')
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })

    expect(() => { vfs.renameSync('/tbm/source', '/tbm/file') })
      .toThrow(expect.objectContaining({ code: 'ENOTDIR' }))
    expect(() => { vfs.renameSync('/tbm/source', '/tbm/non-empty') })
      .toThrow(expect.objectContaining({ code: 'ENOTEMPTY' }))
    expect(() => { vfs.renameSync('/tbm/source', '/missing/destination') })
      .toThrow(expect.objectContaining({ code: 'ENOENT' }))

    expect(vfs.readFileSync('/tbm/source/nested/file', 'utf8')).toBe('source')
    expect(vfs.readFileSync('/tbm/file', 'utf8')).toBe('destination')
    expect(vfs.readFileSync('/tbm/non-empty/child', 'utf8')).toBe('destination')
    expect(mutations).toEqual([])
  })

  it('replaces an empty directory with the source subtree', () => {
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/tbm/source/nested', { mode: 0o700 })
    vfs.seed('/tbm/source/nested/file', 'source')
    vfs.seedDirectory('/tbm/destination', { mode: 0o711 })

    vfs.renameSync('/tbm/source', '/tbm/destination')

    expect(vfs.existsSync('/tbm/source')).toBe(false)
    expect(vfs.readFileSync('/tbm/destination/nested/file', 'utf8')).toBe('source')
    expect((vfs.statSync('/tbm/destination') as VfsStats).mode & 0o777).toBe(0o755)
    expect((vfs.statSync('/tbm/destination/nested') as VfsStats).mode & 0o777).toBe(0o700)
  })
})

describe('hard links', () => {
  it('shares identity, bytes, and mode until one name is removed', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/tbm/session.jsonl', 'committed\n')
    vfs.linkSync('/tbm/session.jsonl', '/tbm/session-latest.jsonl')
    vfs.linkSync('/tbm/session-latest.jsonl', '/tbm/session-archive.jsonl')
    expect(identity(vfs, '/tbm/session-latest.jsonl')).toBe(identity(vfs, '/tbm/session.jsonl'))
    expect(linkCount(vfs, '/tbm/session.jsonl')).toBe(3n)
    expect(vfs.readFileSync('/tbm/session-latest.jsonl', 'utf8')).toBe('committed\n')
    const changedPaths: string[] = []
    vfs.subscribe((mutation) => { changedPaths.push(mutation.path) })
    vfs.appendFileSync('/tbm/session.jsonl', 'appended\n')
    expect(changedPaths).toEqual([
      '/tbm/session.jsonl',
      '/tbm/session-latest.jsonl',
      '/tbm/session-archive.jsonl',
    ])
    expect(vfs.readFileSync('/tbm/session.jsonl', 'utf8')).toBe('committed\nappended\n')
    expect(vfs.readFileSync('/tbm/session-latest.jsonl', 'utf8')).toBe('committed\nappended\n')
    vfs.chmodSync('/tbm/session-latest.jsonl', 0o600)
    expect((vfs.statSync('/tbm/session.jsonl') as VfsStats).mode & 0o777).toBe(0o600)
    vfs.unlinkSync('/tbm/session-latest.jsonl')
    expect(linkCount(vfs, '/tbm/session.jsonl')).toBe(2n)
    vfs.unlinkSync('/tbm/session-archive.jsonl')
    expect(linkCount(vfs, '/tbm/session.jsonl')).toBe(1n)
    expect(vfs.readFileSync('/tbm/session.jsonl', 'utf8')).toBe('committed\nappended\n')
  })

  it('treats rename between names of the same node as a no-op', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/tbm/source', 'value')
    vfs.linkSync('/tbm/source', '/tbm/alias')
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })

    vfs.renameSync('/tbm/source', '/tbm/alias')

    expect(vfs.readFileSync('/tbm/source', 'utf8')).toBe('value')
    expect(vfs.readFileSync('/tbm/alias', 'utf8')).toBe('value')
    expect(linkCount(vfs, '/tbm/source')).toBe(2n)
    expect(mutations).toEqual([])
  })

  it('retargets linked names through file replacement and directory moves', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/tbm/replacement', 'replacement')
    vfs.seed('/tbm/target', 'old')
    vfs.linkSync('/tbm/target', '/tbm/target-alias')
    const replaced = vfs.openFileSync('/tbm/target', 'r+')
    vfs.renameSync('/tbm/replacement', '/tbm/target')
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })

    replaced.write(0, new TextEncoder().encode('changed'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/tbm/target-alias'])
    expect(vfs.readFileSync('/tbm/target', 'utf8')).toBe('replacement')
    expect(vfs.readFileSync('/tbm/target-alias', 'utf8')).toBe('changed')
    expect(linkCount(vfs, '/tbm/target-alias')).toBe(1n)

    vfs.seed('/tbm/tree/file', 'tree')
    vfs.linkSync('/tbm/tree/file', '/tbm/outside')
    const moved = vfs.openFileSync('/tbm/tree/file', 'r+')
    vfs.renameSync('/tbm/tree', '/tbm/moved')
    mutations.length = 0
    moved.write(0, new TextEncoder().encode('moved'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/tbm/outside', '/tbm/moved/file'])
    expect(linkCount(vfs, '/tbm/moved/file')).toBe(2n)

    vfs.rmSync('/tbm/moved', { recursive: true })
    mutations.length = 0
    moved.write(0, new TextEncoder().encode('kept!'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/tbm/outside'])
    expect(vfs.readFileSync('/tbm/outside', 'utf8')).toBe('kept!')
    expect(linkCount(vfs, '/tbm/outside')).toBe(1n)
  })

  it('rejects renaming a file over an existing directory', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/tbm/file', 'value')
    vfs.seedDirectory('/tbm/directory')
    expect(() => { vfs.renameSync('/tbm/file', '/tbm/directory') }).toThrow(expect.objectContaining({ code: 'EISDIR' }))
    expect(vfs.readFileSync('/tbm/file', 'utf8')).toBe('value')
    expect(vfs.statSync('/tbm/directory').isDirectory()).toBe(true)
  })
})
