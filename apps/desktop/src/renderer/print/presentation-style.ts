export const presentationStyle = `
body.presentation { height: 100dvh; display: grid; grid-template-rows: minmax(0,1fr) auto; overflow: hidden; font-size: 22px; }
.presentation #document { width: 100%; height: 100%; min-height: 0; overflow: auto; padding: clamp(24px,5vw,64px); scroll-behavior: auto; }
.presentation-slide[hidden] { display: none; }
.presentation-slide:focus { outline: none; }
.presentation #document:focus-visible { outline: 3px solid #365d36; outline-offset: -3px; }
.presentation-slide > :first-child { margin-top: 0; }
#presentation-controls { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; padding: 12px 16px; border-top: 1px solid #ccd0c7; background: #f5f6f2; color: #20251f; font: 14px/1.5 "Manuslip CJK", "Segoe UI", system-ui, sans-serif; }
#presentation-controls button { min-height: 44px; border: 1px solid #aeb6a6; border-radius: 8px; padding: 8px 14px; background: #fff; color: #20251f; font: inherit; cursor: pointer; }
#presentation-controls button:disabled { color: #687163; cursor: default; }
#presentation-controls button:focus-visible { outline: 3px solid #365d36; outline-offset: 2px; }
#presentation-controls button:last-child { margin-inline-start: auto; background: #365d36; color: #fff; border-color: #365d36; }
#presentation-controls [role="status"] { min-width: 56px; text-align: center; font-variant-numeric: tabular-nums; }
.presentation-keys { margin-inline: 12px; color: #4d5948; }
@media (max-width: 760px) { .presentation-keys { display: none; } }
@media (max-width: 480px) { #presentation-controls { padding: 8px 12px; } #presentation-controls button { padding-inline: 10px; } #presentation-controls button:last-child { margin-inline-start: 0; } #presentation-controls [role="status"] { min-width: 44px; } }
`
