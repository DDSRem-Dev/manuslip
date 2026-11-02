import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit'

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const image = (item) => sha(Buffer.from(item.isRaw() ? item.bin : item.generate()))

/** Inspect real PE resources, including every resolution, independently of build config. */
export async function verifyWindowsApplicationIcon(executable) {
  const expected = Data.IconFile.from(
    await readFile(new URL('../../../apps/desktop/build/icon.ico', import.meta.url)),
  )
    .icons.map((item) => image(item.data))
    .sort()
  const bytes = await readFile(executable)
  const resources = NtExecutableResource.from(NtExecutable.from(bytes))
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries)
  assert.ok(groups.length, `Missing executable icon: ${executable}`)
  // The first icon group is used by shortcuts and the Markdown ProgID's ordinal zero.
  const icons = groups[0].getIconItemsFromEntries(resources.entries)
  assert.deepEqual(icons.map(image).sort(), expected, `Incorrect application icon: ${executable}`)
  return { executable, sha256: sha(bytes), images: expected.length, iconSha256: expected }
}
