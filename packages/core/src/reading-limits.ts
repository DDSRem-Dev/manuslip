const MiB = 1024 * 1024

/** Retained text uses UTF-16 bytes; transport and HTML limits use UTF-8 bytes.
 * Requests stay small and are batched. Responses contain the complete projection.
 */
export const readingBudgets = {
  outputs: 16 * MiB,
  snapshot: 64 * MiB,
  workspace: 32 * MiB,
  projection: 32 * MiB,
  message: 8 * MiB,
  response: 64 * MiB,
  exportRequest: 64 * MiB,
  exportHtml: 64 * MiB,
  reconstructed: 24 * MiB,
} as const
