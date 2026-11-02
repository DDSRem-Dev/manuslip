import { imageSize } from 'image-size'
import { assetLimits } from '../../shared/asset-contracts'
import { FileOperationError } from '../files/errors'
import { imageMime } from '../images/network'

export function rasterInfo(bytes: Buffer): { mime: string; weight: number } {
  let mime: string
  let width: number
  let height: number
  try {
    mime = imageMime(bytes)
    const dimensions = imageSize(bytes)
    width = dimensions.width
    height = dimensions.height
  } catch {
    throw new FileOperationError('asset-type')
  }
  const weight = bytes.length + width * height * 4
  if (
    !width ||
    !height ||
    width > assetLimits.side ||
    height > assetLimits.side ||
    width * height > assetLimits.pixels ||
    bytes.length > assetLimits.bytes ||
    weight > assetLimits.cache
  )
    throw new FileOperationError('asset-large')
  return { mime, weight }
}
