export const fileErrorMessages = {
  'sync-invalid': 'Review the sync connection and choose a valid document destination.',
  'sync-network':
    'The sync destination is unavailable. Your local writing is retained; retry when connected.',
  'sync-auth': 'The sync server refused access. Update the connection credentials and retry.',
  'sync-changed': 'A saved copy changed. Review both versions again before syncing.',
  'sync-validator':
    'The server did not supply a strong version identifier. Existing remote content cannot be replaced safely.',
  'sync-limit':
    'Sync or recovery storage reached its limit. Use a smaller document or remove older recovery copies.',
  'sync-verify':
    'The saved remote copy could not be verified. Review actual versions before retrying.',
  'sync-storage':
    'Sync settings could not be saved. Previous settings and recovery copies are retained.',
  'sync-readonly': 'These sync settings need a newer app version.',
  'sync-busy': 'A sync attempt or native picker is still running. Finish or stop it first.',
  'sync-cancelled': 'Sync was stopped. Review actual saved versions before retrying.',
  'sync-timeout': 'The sync destination took too long. Your local writing is retained; retry.',
  'sync-key-store': 'Credentials could not be stored securely. Retry or use a session credential.',
  'sync-save-first': 'Save this document before syncing its saved version.',
  'sync-recovery':
    'A sync recovery copy could not be verified. Review retained copies before replacing a version.',
  'plugin-invalid': 'Choose a valid Manuslip API 1 plugin bundle and retry.',
  'plugin-storage':
    'Plugin settings could not be saved. Retry; the previous installation is retained.',
  'plugin-readonly': 'Plugin settings belong to a newer app. Use that version to change them.',
  'plugin-permission':
    'This plugin does not have permission for that action. Review its permissions.',
  'plugin-unavailable':
    'This plugin is disabled, changed or unavailable. Review the installed plugin.',
  'plugin-busy': 'A plugin command or file picker is still running. Finish or cancel it first.',
  'plugin-failed': 'The plugin could not finish. Retry the command or disable the plugin.',
  'plugin-timeout': 'The plugin took too long and was stopped. Retry or disable it.',
  'plugin-cancelled': 'The plugin command was cancelled.',
  'plugin-changed': 'The document changed. Run the plugin again before applying its result.',
  'plugin-limit': 'The plugin exceeded its limits. Use a smaller document or another plugin.',
  'pandoc-invalid': 'Choose a supported Pandoc format and profile.',
  'pandoc-tool': 'Select a local Pandoc 3 executable before exporting.',
  'pandoc-changed': 'The selected Pandoc executable changed or is unavailable. Select it again.',
  'pandoc-failed':
    'Pandoc could not convert this copy. Check the document or choose another format.',
  'pandoc-limit': 'Pandoc exceeded its conversion limits. Reduce the document or image sizes.',
  'pandoc-storage':
    'The Pandoc selection could not be saved. Retry; it remains available this session.',
  'pandoc-busy': 'Finish the open Pandoc selection before selecting again.',
  'style-invalid':
    'Use supported document selectors and typography, color, spacing or border declarations. Imports, URLs and application controls are not supported.',
  'style-limit': 'This stylesheet exceeds the appearance limits. Choose a smaller stylesheet.',
  'style-io': 'The stylesheet could not be read. Choose a local UTF-8 CSS file and retry.',
  'style-busy': 'A stylesheet picker is already open. Finish it before importing again.',
  'style-changed': 'The document or appearance changed during import. Import the stylesheet again.',
  'style-persist': 'Appearance could not be saved. Retry; the current session is retained.',
  'style-capacity':
    'Saved appearance is full. Reset an older document before saving another style.',
  'style-readonly': 'Saved appearance belongs to a newer version. Use that version to update it.',
  'export-invalid': 'The export request is invalid. Retry from the document.',
  'presentation-empty': 'Add slide content before starting a presentation.',
  'presentation-limit': 'This presentation exceeds 200 slides. Split the document and retry.',
  'export-image-limit': 'This image exceeds its size limit. Use PDF or a shorter document.',
  'export-incomplete':
    'Some prose is untranslated. Choose source fallback or finish translation before exporting.',
  'export-limit': 'This export exceeds its resource limits. Reduce the document or image sizes.',
  'export-pages': 'This export exceeds the 2,000-page limit. Split the document and export again.',
  'export-busy': 'An export is already running. Wait or cancel it before exporting again.',
  'export-render':
    'Export could not render the document. Check math, diagrams and image files, then retry.',
  'export-asset':
    'An image could not be included. Restore local files or allow remote images, then retry.',
  'export-timeout': 'Export took too long. Reduce the document or retry.',
  'export-cancelled': 'Export was cancelled.',
  'export-target':
    'Choose a matching HTML, PDF, PNG or JPEG destination that is not an open document.',
  'diagram-limit': 'This diagram exceeds the rendering limit. Reduce its size or complexity.',
  'diagram-config':
    'Diagram configuration is controlled by Manuslip. Remove configuration directives or frontmatter to render it.',
  'diagram-busy':
    'Diagram rendering is busy. Visible diagrams will render as capacity becomes available.',
  'diagram-render': 'This diagram could not be rendered. Check its source or retry.',
  'diagram-unsupported':
    'This legacy diagram uses unsupported syntax. Edit its source or convert it to a Mermaid fence.',
  'diagram-timeout': 'This diagram took too long. Edit its source or retry.',
  'diagram-process': 'The diagram renderer stopped. Edit its source or retry.',
  'diagram-paused':
    'Diagram rendering is paused after repeated failures. Choose Retry to restart it.',
  'diagram-cancelled': 'Diagram rendering was cancelled.',
  'asset-save-first': 'Save the document before importing an image, then paste again.',
  'asset-large': 'This image exceeds the image size limit. Paste a smaller image.',
  'asset-busy': 'An image operation is running. Wait a moment and paste again.',
  'asset-type': 'Use a PNG, JPEG, GIF, or WebP image.',
  'asset-outside':
    'Image is outside the granted folder. Reopen the document through its workspace, or move the image into the document folder.',
  'asset-capture': 'The clipboard image is unavailable or expired. Copy the image and paste again.',
  'paste-large': 'This rich-text paste is too large. Use Paste as plain text instead.',
  'paste-busy': 'A paste is running. Wait a moment and try again.',
  'paste-failed': 'Rich-text conversion failed. Use Paste as plain text instead.',
  'search-session': 'These search results are no longer current. Run the search again.',
  'search-binary': 'The bundled search tool is unavailable. Reinstall Manuslip and try again.',
  'search-io':
    'Some files could not be searched. Check access and retry, or choose another folder.',
  'file-incoming-limit': 'Too many incoming files. Open at most 32 files at a time.',
  'file-incoming-type':
    'Drop Markdown or text files. Use Open file or Open folder for other items.',
  'file-incoming-busy': 'An incoming file is opening. Wait a moment and retry.',
  'workspace-busy': 'Folder loading is busy. Wait for the current listing and retry.',
  'workspace-directory': 'Choose a folder to open as a workspace.',
  'workspace-changed': 'This workspace location changed. Reopen the folder or file.',
  'workspace-link':
    'Symbolic links and junctions are excluded. Open the file directly to grant access.',
  'workspace-session': 'This workspace item is no longer available. Refresh or reopen the folder.',
  'workspace-persist':
    'Workspace state could not be saved. Retry; your open documents are retained.',
  'workspace-readonly':
    'Workspace state belongs to a newer version. Use that version to save the session.',
  'workspace-restore-limit':
    'The saved session is full. Forget unavailable files before saving more tabs.',
  'file-tabs':
    'The window has reached its 32-tab limit. Close a tab before opening another document.',
  'file-open': 'This destination is already open in another tab. Choose a different filename.',
  'recovery-io':
    'The recovery checkpoint failed. Your editor content is retained; save a file or copy now.',
  'recovery-capacity':
    'Recovery storage is full. Save or discard older recovered drafts to free space.',
  'file-changed': 'The file changed on disk. Reload, save a copy, or explicitly overwrite it.',
  'file-missing': 'The file was moved or deleted. Save a copy or choose Save As.',
  'file-permission': 'The file could not be written. Check permissions or save a copy.',
  'file-locked': 'The file is locked. Close the other application and retry, or save a copy.',
  'file-storage': 'Storage is full. Free space and retry, or save a copy on another drive.',
  'file-large': 'This document exceeds the 50 MiB editing limit. Open a smaller file.',
  'file-encoding': 'Some characters cannot be saved in this encoding. Choose Save As UTF-8.',
  'file-unsafe': 'Choose an encoding or save a UTF-8 copy before replacing this file.',
  'file-newlines': 'This file has mixed line endings. Choose normalization or save a copy.',
  'file-metadata': 'File metadata cannot be preserved safely. Save a copy instead.',
  'file-session': 'This document session is no longer available. Reopen the file.',
  'file-io': 'The file operation failed. Retry or save a copy; your editor content is retained.',
} as const
export type FileErrorCode = keyof typeof fileErrorMessages
export class FileOperationError extends Error {
  constructor(
    readonly code: FileErrorCode,
    options?: ErrorOptions,
  ) {
    super(fileErrorMessages[code], options)
  }
}
export function fileError(error: unknown): FileOperationError {
  if (error instanceof FileOperationError) return error
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : ''
  switch (code) {
    case 'ENOENT':
      return new FileOperationError('file-missing')
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return new FileOperationError('file-permission')
    case 'EBUSY':
    case 'ETXTBSY':
      return new FileOperationError('file-locked')
    case 'ENOSPC':
    case 'EDQUOT':
      return new FileOperationError('file-storage')
    default:
      return new FileOperationError('file-io')
  }
}
