import { createRoot } from 'react-dom/client'
import { markdownConventionStyle } from '@manuslip/renderer/conventions'
import { App } from './App'
import '../fonts.css'
import './styles.css'
import './navigation.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing application root')
createRoot(root).render(
  <>
    <style>{markdownConventionStyle}</style>
    <App />
  </>,
)
