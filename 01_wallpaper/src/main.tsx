import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Agent verification shim (dev-only, ?bgRaf=1): a headless preview drives the
// page with the tab backgrounded, where native requestAnimationFrame never
// fires — the whole animate loop freezes and live motion can't be verified.
// The flag swaps rAF for a ~30fps Web-Worker pump (page timers are throttled
// to 1Hz in hidden tabs; dedicated-worker timers are not). Never active in a
// production build.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('bgRaf')) {
  const workerSrc = 'setInterval(() => postMessage(0), 33)'
  const pump = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })))
  let nextId = 1
  const pending = new Map<number, FrameRequestCallback>()
  pump.onmessage = () => {
    const run = [...pending.values()]
    pending.clear()
    const now = performance.now()
    for (const cb of run) cb(now)
  }
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = nextId++
    pending.set(id, cb)
    return id
  }
  window.cancelAnimationFrame = (id: number) => {
    pending.delete(id)
  }
  console.log('[bgRaf] requestAnimationFrame → worker pump (background-tab verification)')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
