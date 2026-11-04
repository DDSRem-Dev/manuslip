import { mkdir } from 'node:fs/promises'

export default async function setup() {
  await mkdir(new URL('./result/', import.meta.url), { recursive: true })
}
