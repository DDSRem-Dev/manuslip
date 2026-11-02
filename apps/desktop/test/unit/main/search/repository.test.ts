import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileOperationError } from '../../../../src/main/files/errors'
import { FileSessions } from '../../../../src/main/files/sessions'
import { searchBinary } from '../../../../src/main/search/binary'
import { type runSearchProcess, searchArguments } from '../../../../src/main/search/process'
import { matchEntries, relativeFile } from '../../../../src/main/search/records'
import { SearchRepository } from '../../../../src/main/search/repository'
import { grantRoot } from '../../../../src/main/workspace/paths'
import type { SearchPage, SearchRequest } from '../../../../src/shared/search-contracts'

function request(query: string, mode: SearchRequest['mode'] = 'text'): SearchRequest {
  return { id: randomUUID(), rootId: randomUUID(), query, mode, matchCase: false }
}
async function completed(repository: SearchRepository, id: string): Promise<SearchPage> {
  let page = repository.poll(1, id, 0)
  await vi.waitFor(() => {
    page = repository.poll(1, id, 0)
    expect(page.state).not.toBe('running')
  })
  return page
}
describe('workspace search', () => {
  let root: string, outside: string, files: FileSessions, repository: SearchRepository
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'manuslip-search-')))
    outside = await realpath(await mkdtemp(join(tmpdir(), 'manuslip-search-outside-')))
    files = new FileSessions(() => {})
    repository = new SearchRepository(files)
  })
  afterEach(async () => {
    repository.closeOwner(1)
    await files.closeOwner(1)
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    await rm(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })
  it('runs the vendored binary and searches UTF-8/UTF-16 while honoring ignore rules and link exclusion', async () => {
    await mkdir(join(root, 'chapters'))
    await mkdir(join(root, 'node_modules'))
    await mkdir(join(root, '.git'))
    await writeFile(join(root, '.gitignore'), 'ignored.md\n')
    await writeFile(join(root, 'notes.md'), '# Intro\r\n😀 中文 needle rest\r\n')
    await writeFile(
      join(root, 'chapters', 'notes.md'),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('UTF16 needle\r\n', 'utf16le')]),
    )
    for (const path of [
      'ignored.md',
      '.hidden.md',
      'node_modules/dependency.md',
      '.git/internal.md',
    ])
      await writeFile(join(root, path), 'needle')
    await writeFile(
      join(root, 'invalid.md'),
      Buffer.from([0x82, 0xa0, 32, ...Buffer.from('needle\n')]),
    )
    await writeFile(join(outside, 'secret.md'), 'needle')
    await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    const query = request('needle')
    repository.start(1, query, await grantRoot(root))
    const page = await completed(repository, query.id)
    expect(page.state).toBe('done')
    expect(page.entries.map((entry) => entry.path).sort()).toEqual([
      'chapters/notes.md',
      'notes.md',
    ])
    expect(page.skipped).toBe(1)
    const hit = page.entries.find((entry) => entry.path === 'notes.md')
    if (!hit) throw new Error('Missing UTF-8 result')
    const opened = await repository.open(1, query.id, hit.id)
    expect(opened.anchor).toEqual({ line: 2, from: 6, to: 12, text: '😀 中文 needle rest' })
    expect(opened.file.text).toContain('中文 needle')
    await expect(repository.open(2, query.id, hit.id)).rejects.toMatchObject({
      code: 'search-session',
    })
    const utf16 = page.entries.find((entry) => entry.path.startsWith('chapters/'))
    if (!utf16) throw new Error('Missing UTF-16 result')
    expect((await repository.open(1, query.id, utf16.id)).anchor?.text).toBe('UTF16 needle')
  })
  it('finds unexpanded files with fuzzy paths and revokes results on new queries', async () => {
    await mkdir(join(root, 'chapters'))
    await writeFile(join(root, 'chapters', 'Writing-notes.md'), '# Body')
    await writeFile(join(root, 'other.TXT'), 'text')
    const query = request('wrnt', 'filename')
    repository.start(1, query, await grantRoot(root))
    const page = await completed(repository, query.id)
    expect(page.entries.map((entry) => entry.path)).toEqual(['chapters/Writing-notes.md'])
    expect((await repository.open(1, query.id, page.entries[0]?.id || '')).anchor).toBeNull()
    const newer = request('other', 'filename')
    repository.start(1, newer, await grantRoot(root))
    expect(() => repository.poll(1, query.id, 0)).toThrow()
    expect((await completed(repository, newer.id)).entries.map((entry) => entry.path)).toEqual([
      'other.TXT',
    ])
  })
  it('caps matches, pages bounded batches, treats patterns literally and obeys case selection', async () => {
    await writeFile(join(root, 'matches.md'), 'needle\n'.repeat(510))
    const query = request('needle')
    repository.start(1, query, await grantRoot(root))
    const page = await completed(repository, query.id)
    expect(page.total).toBe(500)
    expect(page.truncated).toBe(true)
    expect(page.entries).toHaveLength(50)
    expect(repository.poll(1, query.id, 450).entries).toHaveLength(50)
    expect(repository.poll(1, query.id, 500).entries).toEqual([])
    await writeFile(join(root, 'literal.md'), '--pre=tool NEEDLE [a-z]+\n')
    for (const [text, matchCase, count] of [
      ['[a-z]+', true, 1],
      ['--pre=tool', false, 1],
      ['NEEDLE', true, 1],
    ] as const) {
      const literal = { ...request(text), matchCase }
      repository.start(1, literal, await grantRoot(root))
      expect((await completed(repository, literal.id)).total).toBe(count)
    }
    expect(searchArguments(request('--pre=tool'))).toContain('--')
  })
  it('denies a listed directory replaced by a junction when opening a search result', async () => {
    await mkdir(join(root, 'folder'))
    await writeFile(join(root, 'folder', 'notes.md'), 'needle')
    await writeFile(join(outside, 'notes.md'), 'private')
    const query = request('needle')
    repository.start(1, query, await grantRoot(root))
    const page = await completed(repository, query.id)
    await rm(join(root, 'folder'), { recursive: true })
    await symlink(outside, join(root, 'folder'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(repository.open(1, query.id, page.entries[0]?.id || '')).rejects.toMatchObject({
      code: 'workspace-changed',
    })
    expect(files.diagnostics.sessions).toBe(0)
  })
  it('keeps only the latest queued search and waits for aborted work to finish before running it', async () => {
    const grant = await grantRoot(root),
      calls: string[] = []
    let finish: (() => void) | undefined
    const run: typeof runSearchProcess = async (_binary, _root, input, signal) => {
      calls.push(input.query)
      if (input.query === 'first')
        await new Promise<void>((resolve) => {
          finish = resolve
          signal.addEventListener('abort', () => {}, { once: true })
        })
      return { truncated: false, failed: false }
    }
    repository = new SearchRepository(files, async () => 'binary', run)
    const first = request('first'),
      second = request('second'),
      latest = request('latest')
    repository.start(1, first, grant)
    await vi.waitFor(() => expect(finish).toBeDefined())
    repository.start(1, second, grant)
    repository.start(1, latest, grant)
    expect(calls).toEqual(['first'])
    finish?.()
    await completed(repository, latest.id)
    expect(calls).toEqual(['first', 'latest'])
    repository.cancel(1, latest.id)
    expect(repository.poll(1, latest.id, 0).state).toBe('cancelled')
    repository.closeOwner(1)
    expect(() => repository.poll(1, latest.id, 0)).toThrow()
  })
  it('reports missing binaries and rejects escaped/unsupported result paths and undecodable lines', async () => {
    repository = new SearchRepository(files, async () => {
      throw new FileOperationError('search-binary')
    })
    const query = request('needle')
    repository.start(1, query, await grantRoot(root))
    expect((await completed(repository, query.id)).error).toBe('search-binary')
    for (const path of ['../outside.md', join(outside, 'file.md'), 'image.png', 'bad\0.md'])
      expect(relativeFile(root, path)).toBeNull()
    expect(matchEntries(root, Buffer.from('invalid'), () => true).skipped).toBe(1)
    expect(await searchBinary()).toMatch(/ripgrep-.*[/\\]bin[/\\]rg(?:\.exe)?$/)
  })
})
