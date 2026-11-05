import { randomUUID } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { RecoveryRepository } from '../../../../src/main/files/recovery'
import { FileSessions } from '../../../../src/main/files/sessions'
import { SearchRepository } from '../../../../src/main/search/repository'
import { WorkspaceRepository } from '../../../../src/main/workspace/repository'
import { WorkspaceStateRepository } from '../../../../src/main/workspace/state'
import type { FileSnapshot } from '../../../../src/shared/file-contracts'
import type { SearchRequest } from '../../../../src/shared/search-contracts'

let directory: string,
  root: string,
  files: FileSessions,
  search: SearchRepository,
  workspace: WorkspaceRepository,
  state: WorkspaceStateRepository
const changes: { owner: number; id: string }[] = []
const dialogs = { open: async () => null, save: async () => null, overwrite: async () => false }
async function start(): Promise<void> {
  files = new FileSessions((owner, id) => changes.push({ owner, id }))
  search = new SearchRepository(files)
  state = new WorkspaceStateRepository(join(directory, 'workspace.json'))
  await state.load()
  workspace = new WorkspaceRepository(state, files, (owner) => search.closeOwner(owner))
  await workspace.bootstrap(1)
}
async function stop(): Promise<void> {
  workspace.closeOwner(1)
  search.closeOwner(1)
  await files.closeOwner(1)
}
async function query(text: string, mode: SearchRequest['mode'] = 'text') {
  const selected = workspace.describe(1).root
  if (!selected) throw new Error('Missing workspace root')
  const request: SearchRequest = {
    id: randomUUID(),
    rootId: selected.id,
    query: text,
    mode,
    matchCase: true,
  }
  search.start(1, request, workspace.searchGrant(1, selected.id))
  await expect.poll(() => search.poll(1, request.id, 0).state).toBe('done')
  return { request, page: search.poll(1, request.id, 0) }
}
async function save(snapshot: FileSnapshot, text: string, revision = 1, destination?: string) {
  return files.save(
    1,
    {
      id: snapshot.info.id,
      text,
      revision,
      expectedFingerprint: snapshot.info.fingerprint,
      action: destination ? 'save-as' : 'save',
      normalize: null,
      utf8: false,
    },
    { ...dialogs, save: async () => destination || null },
  )
}
beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'manuslip-search-files-')))
  root = join(directory, 'workspace')
  await mkdir(join(root, 'chapters'), { recursive: true })
  changes.length = 0
  await start()
  await workspace.choose(1, root)
})
afterEach(async () => {
  await stop()
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

it('pages native search results, excludes ignored files and opens a Unicode match for an exact UTF-16 save', async () => {
  await mkdir(join(root, '.git'))
  await mkdir(join(root, 'node_modules'))
  await writeFile(join(root, '.gitignore'), 'ignored.md\n')
  await Promise.all(
    Array.from({ length: 56 }, (_, index) =>
      writeFile(join(root, `note-${index}.md`), `needle ${index}\n`),
    ),
  )
  for (const path of ['ignored.md', '.hidden.md', 'node_modules/dependency.md'])
    await writeFile(join(root, path), 'needle')
  const text = '# 世界\r\n😀 needle 中文\r\n',
    path = join(root, 'chapters', 'unicode.md')
  const utf16 = (value: string) =>
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(value, 'utf16le')])
  await writeFile(path, utf16(text))
  const { request, page } = await query('needle')
  const second = search.poll(1, request.id, page.cursor)
  expect(page).toMatchObject({ total: 57, truncated: false, skipped: 0, cursor: 50 })
  expect(page.entries).toHaveLength(50)
  expect(second.entries).toHaveLength(7)
  const entries = [...page.entries, ...second.entries]
  expect(new Set(entries.map((entry) => entry.id)).size).toBe(57)
  expect(entries.map((entry) => entry.path)).not.toContain('ignored.md')
  const hit = entries.find((entry) => entry.path === 'chapters/unicode.md')
  if (!hit) throw new Error('Missing UTF-16 search hit')
  const opened = await search.open(1, request.id, hit.id)
  expect(opened.anchor).toEqual({ line: 2, from: 3, to: 9, text: '😀 needle 中文' })
  expect(opened.file.info).toMatchObject({ encoding: 'utf16le', bom: true, newline: 'crlf' })
  expect((await search.open(1, request.id, hit.id)).file.info.id).toBe(opened.file.info.id)
  expect(await save(opened.file, '# 世界\n😀 replaced 中文\n')).toMatchObject({ kind: 'saved' })
  expect(await readFile(path)).toEqual(utf16('# 世界\r\n😀 replaced 中文\r\n'))
  expect(files.diagnostics).toEqual({ sessions: 1, files: 1, watchers: 1 })
})

it('opens native matches at exact source offsets around in-line BOM characters', async () => {
  const line = '\uFEFF😀 needle\uFEFF needle'
  const path = join(root, 'unicode.md')
  await writeFile(path, `# Heading\r\n${line}\r\n`)
  const { request, page } = await query('needle')
  expect(page).toMatchObject({ total: 2, truncated: false, skipped: 0 })
  const anchors = []
  for (const entry of page.entries) {
    const opened = await search.open(1, request.id, entry.id)
    expect(opened.file.text).toBe(`# Heading\n${line}\n`)
    anchors.push(opened.anchor)
  }
  expect(anchors).toEqual([
    { line: 2, from: 4, to: 10, text: line },
    { line: 2, from: 12, to: 18, text: line },
  ])
})

it('restores named tabs in order while keeping a newer checkpoint separate from the saved file', async () => {
  const firstPath = join(root, 'first.md'),
    secondPath = join(root, 'second.md')
  await writeFile(firstPath, '# First\n')
  await writeFile(secondPath, '# Second\n')
  const { request, page } = await query('.md', 'filename')
  const firstHit = page.entries.find((entry) => entry.path === 'first.md'),
    secondHit = page.entries.find((entry) => entry.path === 'second.md')
  if (!firstHit || !secondHit) throw new Error('Missing saved documents')
  const first = (await search.open(1, request.id, firstHit.id)).file,
    second = (await search.open(1, request.id, secondHit.id)).file
  const recoveryPath = join(directory, 'recovery')
  const recovery = new RecoveryRepository(recoveryPath)
  await recovery.load()
  await recovery.checkpoint(
    { id: first.info.id, revision: 2, text: '# Newer unsaved 世界 😀\n' },
    first.info,
  )
  await save(first, '# Saved revision\n')
  await recovery.clear(first.info.id, 1)
  await workspace.remember(1, { ids: [second.info.id, first.info.id], activeId: first.info.id })
  await stop()
  await start()
  const bootstrap = await workspace.bootstrap(1)
  expect(bootstrap.restore.map((entry) => [entry.name, entry.active])).toEqual([
    ['second.md', false],
    ['first.md', true],
  ])
  const restored = await workspace.restore(1, bootstrap.restore[1]?.id || '')
  expect(restored.text).toBe('# Saved revision\n')
  const restarted = new RecoveryRepository(recoveryPath)
  await restarted.load()
  expect(restarted.list()).toMatchObject([{ id: first.info.id, revision: 2 }])
  const draft = files.create(1),
    draftText = await restarted.restore(first.info.id)
  restarted.claim(first.info.id, draft.info.id)
  await restarted.checkpoint({ id: draft.info.id, revision: 0, text: draftText }, draft.info)
  const destination = join(root, 'recovered.md')
  expect(await save(draft, draftText, 1, destination)).toMatchObject({ kind: 'saved' })
  await restarted.clear(draft.info.id, 1)
  const clean = new RecoveryRepository(recoveryPath)
  await clean.load()
  expect(clean.list()).toEqual([])
  expect(await readFile(firstPath, 'utf8')).toBe('# Saved revision\n')
  expect(await readFile(destination, 'utf8')).toBe('# Newer unsaved 世界 😀\n')
})

it('revokes search results when the workspace changes and rechecks directory grants before saving an opened hit', async () => {
  const chapter = join(root, 'chapters'),
    path = join(chapter, 'writing.md')
  await writeFile(path, '# needle\n')
  const { request, page } = await query('needle')
  const hit = page.entries[0]
  if (!hit) throw new Error('Missing search hit')
  await expect(search.open(2, request.id, hit.id)).rejects.toMatchObject({ code: 'search-session' })
  const opened = (await search.open(1, request.id, hit.id)).file
  const outside = join(directory, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'writing.md'), 'private outside file')
  await rename(chapter, join(root, 'original-chapters'))
  await symlink(outside, chapter, process.platform === 'win32' ? 'junction' : 'dir')
  await expect(save(opened, 'must never escape the grant')).rejects.toMatchObject({
    code: 'workspace-link',
  })
  expect(await readFile(join(outside, 'writing.md'), 'utf8')).toBe('private outside file')
  expect(await readFile(join(root, 'original-chapters', 'writing.md'), 'utf8')).toBe('# needle\n')
  await workspace.choose(1, outside)
  expect(() => search.poll(1, request.id, 0)).toThrow()
  await expect(search.open(1, request.id, hit.id)).rejects.toMatchObject({ code: 'search-session' })
})

it('delivers real filesystem replacement notifications to files opened by native search and releases all watchers', async () => {
  const path = join(root, 'writing.md')
  await writeFile(path, '# needle\n')
  await writeFile(join(root, 'other.md'), 'needle')
  const { request, page } = await query('needle')
  const opened = await Promise.all(
    page.entries.map((entry) => search.open(1, request.id, entry.id)),
  )
  const target = opened.find((entry) => entry.file.info.name === 'writing.md')?.file
  if (!target) throw new Error('Missing watched file')
  expect(files.diagnostics).toEqual({ sessions: 2, files: 2, watchers: 1 })
  await writeFile(join(root, 'replacement.tmp'), '# External replacement 世界\r\n')
  await rename(join(root, 'replacement.tmp'), path)
  await expect.poll(() => changes).toContainEqual({ owner: 1, id: target.info.id })
  expect((await files.reload(1, target.info.id)).text).toBe('# External replacement 世界\n')
  await stop()
  expect(files.diagnostics).toEqual({ sessions: 0, files: 0, watchers: 0 })
})
