import type { DesktopBridge } from '../../shared/contracts'

declare global {
  interface Window {
    manuslip: DesktopBridge
  }
}
