import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { runIconsTool } from 'app-builder-lib/out/toolsets/icons.js'

const build = fileURLToPath(new URL('../apps/desktop/build/', import.meta.url))
const source = new URL('../apps/desktop/build/icon.svg', import.meta.url)
const manifest = new URL('../apps/desktop/build/icons.json', import.meta.url)
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const builder = JSON.parse(
  await readFile(new URL('../node_modules/electron-builder/package.json', import.meta.url)),
)
const inputs = {
  sourceSha256: sha(await readFile(source)),
  generatorSha256: sha(await readFile(fileURLToPath(import.meta.url))),
  electronBuilderVersion: builder.version,
}
const check = process.argv.includes('--check')
if (!check) {
  // Use the pinned packager's portable SVG converter; no browser or native graphics dependency.
  for (const format of ['ico', 'icns', 'set']) {
    await runIconsTool({
      inputFile: fileURLToPath(source),
      outputFormat: format,
      outDir: format === 'set' ? `${build}/icons` : build,
    })
  }
}
const files = [
  'icon.ico',
  'icon.icns',
  ...(await readdir(`${build}/icons`))
    .filter((name) => name.endsWith('.png'))
    .sort()
    .map((name) => `icons/${name}`),
]
const assets = []
for (const path of files) {
  const bytes = await readFile(`${build}/${path}`)
  if (path.endsWith('.png')) {
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    const size = Number(path.split('/').at(-1).split('x')[0])
    assert.equal(bytes.readUInt32BE(16), size)
    assert.equal(bytes.readUInt32BE(20), size)
  }
  assets.push({ path, bytes: bytes.length, sha256: sha(bytes) })
}
for (const size of [16, 32, 48, 128, 256, 512])
  assert.ok(files.includes(`icons/${size}x${size}.png`), `Missing ${size}px application icon`)
const result = { ...inputs, files: assets }
if (check) {
  assert.deepEqual(
    JSON.parse(await readFile(manifest)),
    result,
    'Application icons are stale; run npm run icons',
  )
  console.log('Application icon source, converter version and all generated assets verified')
} else {
  await writeFile(manifest, `${JSON.stringify(result, null, 2)}\n`)
  console.log(`Generated ${assets.length} application icon assets from icon.svg`)
}
