import { randomUUID } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileSessions } from '../../../../src/main/files/sessions'
import { WorkspaceCatalog } from '../../../../src/main/workspace/catalog'
import { grantRoot } from '../../../../src/main/workspace/paths'
import { WorkspaceRepository } from '../../../../src/main/workspace/repository'
import { WorkspaceStateRepository } from '../../../../src/main/workspace/state'
import type { FileInfo, SaveRequest } from '../../../../src/shared/file-contracts'
import { type WorkspaceChange, workspaceLimits } from '../../../../src/shared/workspace-contracts'

function request(info: FileInfo): SaveRequest {
  return {
    id: info.id,
    revision: 1,
    text: 'edited',
    expectedFingerprint: info.fingerprint,
    action: 'save',
    normalize: null,
    utf8: false,
  }
}
describe('main workspace grants and state', () => {
  let directory: string
  let root: string
  let state: WorkspaceStateRepository
  let files: FileSessions
  let workspaces: WorkspaceRepository
  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'manuslip-workspace-')))
    root = join(directory, 'writing')
    await mkdir(root)
    state = new WorkspaceStateRepository(join(directory, 'profile', 'workspace-state.json'))
    await state.load()
    files = new FileSessions(() => {})
    workspaces = new WorkspaceRepository(state, files)
  })
  afterEach(async () => {
    workspaces.closeOwner(1)
    workspaces.closeOwner(2)
    await files.closeOwner(1)
    await files.closeOwner(2)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  it('lazily lists Markdown/text and shares records without accepting path-shaped IDs', async () => {
    await mkdir(join(root, 'chapter'))
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'notes.md'), 'writing')
    await writeFile(join(root, 'ignored.png'), 'image')
    await writeFile(join(root, 'chapter', '世界.txt'), 'chapter')
    const boot = await workspaces.choose(1, root)
    const page = await workspaces.list(1, boot.root?.id || '', 0)
    expect(page.nodes.map((node) => node.name)).toEqual(['chapter', 'notes.md'])
    await expect(workspaces.list(2, boot.root?.id || '', 0)).rejects.toMatchObject({
      code: 'workspace-session',
    })
    await expect(workspaces.open(1, '../notes.md')).rejects.toMatchObject({
      code: 'workspace-session',
    })
    const file = page.nodes.find((node) => node.kind === 'file')
    const first = await workspaces.open(1, file?.id || '')
    const second = await workspaces.open(1, file?.id || '')
    expect(first.info.id).toBe(second.info.id)
    expect(files.diagnostics).toEqual({ sessions: 1, files: 1, watchers: 1 })
    const chapter = await workspaces.list(1, page.nodes[0]?.id || '', 0)
    expect(chapter.nodes[0]?.name).toBe('世界.txt')
  })
  describe('directory scan boundary', () => {
    beforeEach(async () => {
      // Creating 5,002 physical files is fixture setup, not catalog latency. Allow
      // slow filesystem/antivirus setup without relaxing the test body's deadline.
      await Promise.all(
        Array.from({ length: workspaceLimits.scan + 2 }, (_, index) =>
          writeFile(join(root, `${index}.md`), ''),
        ),
      )
    }, 30_000)
    it('pages stable IDs and explicitly truncates the directory scan', async () => {
      const catalog = new WorkspaceCatalog(await grantRoot(root))
      const first = await catalog.list(catalog.root.id, 0)
      expect(first.nodes).toHaveLength(workspaceLimits.page)
      expect(first.truncated).toBe(true)
      expect(first.next).toBe(workspaceLimits.page)
      expect((await catalog.list(catalog.root.id, 0)).nodes).toEqual(first.nodes)
      const next = await catalog.list(catalog.root.id, first.next || 0)
      expect(next.nodes).toHaveLength(workspaceLimits.page)
      expect(next.nodes.some((node) => first.nodes.some((item) => item.id === node.id))).toBe(false)
      catalog.dispose()
    })
  })
  it('watches browsed directories while preserving unchanged IDs and revoking removed subtrees', async () => {
    const changes: { owner: number; change: WorkspaceChange }[] = []
    workspaces = new WorkspaceRepository(state, files, undefined, (owner, change) =>
      changes.push({ owner, change }),
    )
    await mkdir(join(root, 'chapters'))
    await writeFile(join(root, 'notes.md'), 'notes')
    await writeFile(join(root, 'chapters', 'first.md'), 'first chapter')
    const boot = await workspaces.choose(1, root)
    const rootId = boot.root?.id || ''
    const first = await workspaces.list(1, rootId, 0)
    const chapterId = first.nodes[0]?.id || ''
    const child = (await workspaces.list(1, chapterId, 0)).nodes[0]
    const opened = await workspaces.open(1, child?.id || '')

    await writeFile(join(root, 'new.md'), 'new')
    await expect
      .poll(() =>
        changes.some(
          ({ owner, change }) =>
            owner === 1 && change.rootId === rootId && change.directoryId === rootId,
        ),
      )
      .toBe(true)
    const updated = await workspaces.list(1, rootId, 0)
    expect(updated.nodes.map((node) => node.name)).toEqual(['chapters', 'new.md', 'notes.md'])
    expect(updated.nodes.filter((node) => node.name !== 'new.md')).toEqual(first.nodes)
    expect(workspaces.describe(1).root?.id).toBe(rootId)

    await rename(join(root, 'chapters', 'first.md'), join(root, 'chapters', 'renamed.md'))
    await expect
      .poll(() => changes.some(({ change }) => change.directoryId === chapterId))
      .toBe(true)
    expect((await workspaces.list(1, chapterId, 0)).nodes[0]?.name).toBe('renamed.md')
    await expect(workspaces.open(1, child?.id || '')).rejects.toMatchObject({
      code: 'workspace-session',
    })

    await rm(join(root, 'chapters'), { recursive: true })
    await expect
      .poll(async () => (await workspaces.list(1, rootId, 0)).nodes.map((node) => node.name))
      .toEqual(['new.md', 'notes.md'])
    await expect(workspaces.list(1, chapterId, 0)).rejects.toMatchObject({
      code: 'workspace-session',
    })
    expect(files.describe(1, opened.info.id).name).toBe('first.md')
    expect(changes.every(({ owner }) => owner === 1)).toBe(true)
  })
  it('reconciles all browsed folders on window focus without resetting their IDs', async () => {
    await mkdir(join(root, 'chapters'))
    const boot = await workspaces.choose(1, root)
    const rootId = boot.root?.id || ''
    const chapterId = (await workspaces.list(1, rootId, 0)).nodes[0]?.id || ''
    await workspaces.list(1, chapterId, 0)
    await writeFile(join(root, 'chapters', 'back-from-sleep.md'), 'writing')
    workspaces.checkExternal(1)
    expect((await workspaces.list(1, chapterId, 0)).nodes[0]?.name).toBe('back-from-sleep.md')
    expect((await workspaces.list(1, rootId, 0)).nodes[0]?.id).toBe(chapterId)
    expect(workspaces.describe(1).root?.id).toBe(rootId)
  })
  it('revokes stale tree IDs on Refresh without closing documents', async () => {
    await writeFile(join(root, 'notes.md'), 'notes')
    const boot = await workspaces.choose(1, root)
    const first = (await workspaces.list(1, boot.root?.id || '', 0)).nodes[0]
    const opened = await workspaces.open(1, first?.id || '')
    const refreshed = await workspaces.refresh(1)
    expect(refreshed.root?.id).not.toBe(boot.root?.id)
    await expect(workspaces.open(1, first?.id || '')).rejects.toMatchObject({
      code: 'workspace-session',
    })
    expect(files.describe(1, opened.info.id).name).toBe('notes.md')
  })
  it('closes the folder persistently while retaining open documents and recent folders', async () => {
    await writeFile(join(root, 'notes.md'), 'notes')
    const boot = await workspaces.choose(1, root)
    const rootId = boot.root?.id || ''
    const node = (await workspaces.list(1, rootId, 0)).nodes[0]
    const opened = await workspaces.open(1, node?.id || '')
    await workspaces.remember(1, { ids: [opened.info.id], activeId: opened.info.id })

    const closed = await workspaces.close(1)
    expect(closed.root).toBeNull()
    expect(closed.recents.map((entry) => entry.displayPath)).toEqual([root])
    expect((await workspaces.bootstrap(1)).root).toBeNull()
    expect((await workspaces.refresh(1)).root).toBeNull()
    await expect(workspaces.list(1, rootId, 0)).rejects.toMatchObject({ code: 'workspace-session' })
    await expect(workspaces.open(1, node?.id || '')).rejects.toMatchObject({
      code: 'workspace-session',
    })
    expect(() => workspaces.searchGrant(1, rootId)).toThrow()
    expect(files.describe(1, opened.info.id)).toEqual(opened.info)

    const stored = new WorkspaceStateRepository(join(directory, 'profile', 'workspace-state.json'))
    await stored.load()
    expect(stored.get()).toMatchObject({
      root: null,
      recents: [root],
      documents: [join(root, 'notes.md')],
      activePath: join(root, 'notes.md'),
    })
    const reopened = await workspaces.recent(1, closed.recents[0]?.id || '')
    expect(reopened.root?.displayPath).toBe(root)
    expect(reopened.root?.id).not.toBe(rootId)
    expect(files.describe(1, opened.info.id)).toEqual(opened.info)
  })
  it('skips junctions and refuses changed parent junctions for open, reload and save', async () => {
    const outside = join(directory, 'outside')
    const chapter = join(root, 'chapter')
    await mkdir(outside)
    await mkdir(chapter)
    await writeFile(join(chapter, 'notes.md'), 'inside')
    await writeFile(join(outside, 'notes.md'), 'private')
    await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    const boot = await workspaces.choose(1, root)
    const page = await workspaces.list(1, boot.root?.id || '', 0)
    expect(page.skippedLinks).toBe(true)
    expect(page.nodes.map((node) => node.name)).toEqual(['chapter'])
    const node = (await workspaces.list(1, page.nodes[0]?.id || '', 0)).nodes[0]
    const opened = await workspaces.open(1, node?.id || '')
    await rename(chapter, join(root, 'original-chapter'))
    await symlink(outside, chapter, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(workspaces.open(1, node?.id || '')).rejects.toMatchObject({
      code: 'workspace-link',
    })
    await expect(files.reload(1, opened.info.id)).rejects.toMatchObject({ code: 'workspace-link' })
    await expect(
      files.save(1, request(opened.info), {
        open: async () => null,
        save: async () => null,
        overwrite: async () => true,
      }),
    ).rejects.toMatchObject({ code: 'workspace-link' })
    expect(await readFile(join(outside, 'notes.md'), 'utf8')).toBe('private')
  })
  it('persists ordered named tabs, excludes drafts and retains missing files until forgotten', async () => {
    const a = join(root, 'a.md'),
      b = join(root, 'b.md')
    await writeFile(a, 'a')
    await writeFile(b, 'b')
    await workspaces.choose(1, root)
    const first = await files.open(1, a),
      second = await files.open(1, b),
      draft = files.create(1)
    await workspaces.remember(1, {
      ids: [second.info.id, draft.info.id, first.info.id],
      activeId: first.info.id,
    })
    const reloaded = new WorkspaceStateRepository(
      join(directory, 'profile', 'workspace-state.json'),
    )
    await reloaded.load()
    expect(reloaded.get().documents).toEqual([b, a])
    expect(reloaded.get().activePath).toBe(a)
    const next = new WorkspaceRepository(reloaded, files)
    const boot = await next.bootstrap(2)
    expect(boot.restore.map((entry) => entry.displayPath)).toEqual([b, a])
    await rm(b)
    await expect(next.restore(2, boot.restore[0]?.id || '')).rejects.toMatchObject({
      code: 'file-missing',
    })
    const restored = await next.restore(2, boot.restore[1]?.id || '')
    await next.remember(2, { ids: [restored.info.id], activeId: restored.info.id })
    expect(reloaded.get().documents).toEqual([a, b])
    await next.forget(boot.restore[0]?.id || '')
    expect(reloaded.get().documents).toEqual([a])
    await expect(
      next.remember(2, { ids: [first.info.id], activeId: first.info.id }),
    ).rejects.toMatchObject({ code: 'file-session' })
  })
  it('preserves future state and backs up corrupt state before reset', async () => {
    const path = join(directory, 'future.json')
    const text = JSON.stringify({ schemaVersion: 99, secret: 'keep' })
    await writeFile(path, text)
    const future = new WorkspaceStateRepository(path)
    await future.load()
    expect(future.readOnly).toBe(true)
    await expect(future.save({ root })).rejects.toMatchObject({ code: 'workspace-readonly' })
    expect(await readFile(path, 'utf8')).toBe(text)
    expect((await readdir(directory)).some((name) => name.startsWith('future.json.backup-'))).toBe(
      true,
    )
    const bad = join(directory, 'bad.json')
    await writeFile(bad, '{broken')
    const corrupt = new WorkspaceStateRepository(bad)
    await corrupt.load()
    expect(corrupt.recovered).toBe(true)
    const backup = (await readdir(directory)).find((name) => name.startsWith('bad.json.backup-'))
    expect(backup && (await readFile(join(directory, backup), 'utf8'))).toBe('{broken')
    await corrupt.save({ root })
    expect(JSON.parse(await readFile(bad, 'utf8')).root).toBe(root)
  })
  it('coalesces writes and exposes storage failure while retaining desired metadata', async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        state.save({ documents: [join(root, `${index}.md`)], activePath: null }),
      ),
    )
    const path = join(directory, 'profile', 'workspace-state.json')
    expect(JSON.parse(await readFile(path, 'utf8')).documents).toEqual([join(root, '49.md')])
    expect(
      (await readdir(join(directory, 'profile'))).filter((name) => name.endsWith('.tmp')),
    ).toEqual([])
    const blocker = join(directory, 'blocker')
    await writeFile(blocker, '')
    const failed = new WorkspaceStateRepository(join(blocker, 'state.json'))
    await expect(failed.save({ root })).rejects.toMatchObject({ code: 'workspace-persist' })
    expect(failed.persistenceError).toBe(true)
    expect(failed.get().root).toBe(root)
    await rm(blocker)
    await failed.save({ root })
    expect(failed.persistenceError).toBe(false)
  })
  it('bounds recents and rejects fabricated IDs', async () => {
    for (let index = 0; index < 12; index++) {
      const path = join(directory, `root-${index}`)
      await mkdir(path)
      await workspaces.choose(1, path)
    }
    expect(workspaces.describe(1).recents).toHaveLength(workspaceLimits.recent)
    await expect(workspaces.recent(1, randomUUID())).rejects.toMatchObject({
      code: 'workspace-session',
    })
  })
  it('bounds listing concurrency and rejects work against a replaced catalog', async () => {
    const boot = await workspaces.choose(1, root)
    const requests = Array.from({ length: 10 }, () => workspaces.list(1, boot.root?.id || '', 0))
    const results = await Promise.allSettled(requests)
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(9)
    expect(results[9]).toMatchObject({ status: 'rejected', reason: { code: 'workspace-busy' } })
    const pending = workspaces.list(1, boot.root?.id || '', 0)
    workspaces.closeOwner(1)
    await expect(pending).rejects.toMatchObject({ code: 'workspace-session' })
  })
})
