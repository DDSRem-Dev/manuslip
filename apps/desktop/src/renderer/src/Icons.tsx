import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise'
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise'
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise'
import { ArrowsInIcon } from '@phosphor-icons/react/dist/csr/ArrowsIn'
import { ArrowsOutIcon } from '@phosphor-icons/react/dist/csr/ArrowsOut'
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown'
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight'
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check'
import { ClipboardTextIcon } from '@phosphor-icons/react/dist/csr/ClipboardText'
import { CodeIcon } from '@phosphor-icons/react/dist/csr/Code'
import { CopyIcon } from '@phosphor-icons/react/dist/csr/Copy'
import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree'
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple'
import { EyeIcon } from '@phosphor-icons/react/dist/csr/Eye'
import { FeatherIcon } from '@phosphor-icons/react/dist/csr/Feather'
import { FileCodeIcon } from '@phosphor-icons/react/dist/csr/FileCode'
import { FilePdfIcon } from '@phosphor-icons/react/dist/csr/FilePdf'
import { FilePlusIcon } from '@phosphor-icons/react/dist/csr/FilePlus'
import { FileTextIcon } from '@phosphor-icons/react/dist/csr/FileText'
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk'
import { FolderIcon } from '@phosphor-icons/react/dist/csr/Folder'
import { FolderOpenIcon } from '@phosphor-icons/react/dist/csr/FolderOpen'
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix'
import { ImageIcon } from '@phosphor-icons/react/dist/csr/Image'
import { ListBulletsIcon } from '@phosphor-icons/react/dist/csr/ListBullets'
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass'
import { MonitorIcon } from '@phosphor-icons/react/dist/csr/Monitor'
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple'
import { PlugIcon } from '@phosphor-icons/react/dist/csr/Plug'
import { ScissorsIcon } from '@phosphor-icons/react/dist/csr/Scissors'
import { SelectionAllIcon } from '@phosphor-icons/react/dist/csr/SelectionAll'
import { SidebarSimpleIcon } from '@phosphor-icons/react/dist/csr/SidebarSimple'
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/csr/SlidersHorizontal'
import { TableIcon } from '@phosphor-icons/react/dist/csr/Table'
import { TextAaIcon } from '@phosphor-icons/react/dist/csr/TextAa'
import { TranslateIcon } from '@phosphor-icons/react/dist/csr/Translate'
import { XIcon } from '@phosphor-icons/react/dist/csr/X'

const icons = {
  appearance: TextAaIcon,
  check: CheckIcon,
  chevron: CaretDownIcon,
  chevronRight: CaretRightIcon,
  close: XIcon,
  code: CodeIcon,
  copy: CopyIcon,
  cut: ScissorsIcon,
  document: FileTextIcon,
  export: DownloadSimpleIcon,
  edit: PencilSimpleIcon,
  feather: FeatherIcon,
  fileCode: FileCodeIcon,
  filePdf: FilePdfIcon,
  focus: ArrowsInIcon,
  folder: FolderIcon,
  image: ImageIcon,
  live: EyeIcon,
  more: DotsThreeIcon,
  new: FilePlusIcon,
  open: FolderOpenIcon,
  outline: ListBulletsIcon,
  plugins: PlugIcon,
  paste: ClipboardTextIcon,
  present: MonitorIcon,
  refresh: ArrowsClockwiseIcon,
  reset: ArrowCounterClockwiseIcon,
  undo: ArrowCounterClockwiseIcon,
  redo: ArrowClockwiseIcon,
  save: FloppyDiskIcon,
  search: MagnifyingGlassIcon,
  selectAll: SelectionAllIcon,
  settings: GearSixIcon,
  sidebar: SidebarSimpleIcon,
  sliders: SlidersHorizontalIcon,
  sync: ArrowsClockwiseIcon,
  table: TableIcon,
  translate: TranslateIcon,
  unfocus: ArrowsOutIcon,
} as const

export type IconName = keyof typeof icons

/** Decorative icons inherit the control's accessible name and current text color. */
export function Icon({ name, size = 18 }: { name: IconName; size?: number }): React.JSX.Element {
  const Glyph = icons[name]
  return (
    <Glyph className="ui-icon" size={size} weight="regular" aria-hidden="true" focusable="false" />
  )
}
