export interface EditorPreferences {
  lineNumbers: boolean
  wrapLines: boolean
  tabSize: 2 | 4 | 8
}

export const defaultEditorPreferences: Readonly<EditorPreferences> = Object.freeze({
  lineNumbers: true,
  wrapLines: true,
  tabSize: 4,
})
