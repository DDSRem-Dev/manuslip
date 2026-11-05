const assert = require('node:assert/strict')
const { constants } = require('node:fs')
const { chmod, copyFile, open, readdir, readFile, unlink } = require('node:fs/promises')
const { createHash } = require('node:crypto')
const { join } = require('node:path')
const { Arch } = require('builder-util')

async function removeWorkspaceMetadata(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await removeWorkspaceMetadata(path)
    else if (entry.isFile() && entry.name.startsWith('.uuid')) {
      // Only generated package output is cleaned; source and linked directories are untouched.
      await unlink(path).catch((error) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
  }
}

module.exports = async (context) => {
  await removeWorkspaceMetadata(context.appOutDir)
  if (context.electronPlatformName === 'darwin') {
    // Apple Silicon needs a valid ad-hoc signature after modifying an unsigned binary.
    context.packager.config.electronFuses = {
      ...context.packager.config.electronFuses,
      resetAdHocDarwinSignature: context.arch === Arch.arm64,
    }
  }
  if (context.electronPlatformName !== 'linux') return
  const executable = join(context.appOutDir, context.packager.executableName)
  const resources = join(context.appOutDir, 'resources', 'native-fonts')
  const font = await readFile(join(resources, 'NotoSansCJKsc-VF.ttf'))
  assert.equal(
    createHash('sha256').update(font).digest('hex'),
    '990c807e79c25662a5a9ecf7f971baeb2bf2eab9a559e5ecf15cdfdb8561d21f',
    'The Linux native font must match the pinned source',
  )
  const handle = await open(executable, 'r')
  try {
    const magic = Buffer.alloc(4)
    await handle.read(magic, 0, 4, 0)
    assert.equal(magic.toString('hex'), '7f454c46', 'Expected the original Linux ELF executable')
  } finally {
    await handle.close()
  }
  // electron-builder flips fuses after afterPack. Flip the ELF before replacing it
  // with a shell launcher, then disable its second pass over the launcher script.
  await context.packager.addElectronFuses(
    context,
    await context.packager.generateFuseConfig({
      ...context.packager.config.electronFuses,
      // Electron implements embedded ASAR integrity on Windows and macOS only.
      enableEmbeddedAsarIntegrityValidation: false,
    }),
  )
  await copyFile(executable, `${executable}-bin`, constants.COPYFILE_EXCL)
  context.packager.config.electronFuses = null
  await chmod(`${executable}-bin`, 0o755)
  await copyFile(join(__dirname, 'linux-launcher.sh'), executable)
  await chmod(executable, 0o755)
}
