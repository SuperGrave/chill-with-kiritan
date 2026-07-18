import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// Agent verification shim (dev-only, ?bgRaf=1) — same affordance as
// 01_wallpaper/src/main.tsx: a headless preview drives the page with the tab
// backgrounded, where native requestAnimationFrame never fires and page timers
// are throttled to 1Hz, freezing the news ticker and the spectrum panel. The
// flag swaps rAF AND setInterval for a ~30fps dedicated-worker pump (worker
// timers are not throttled). Never active in a production build.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('bgRaf')) {
  const workerSrc = 'setInterval(() => postMessage(0), 33)'
  const pump = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })))
  let nextId = 1
  const pendingRaf = new Map<number, FrameRequestCallback>()
  type TimerEntry = { fn: (...args: unknown[]) => void; ms: number; last: number; args: unknown[] }
  const timers = new Map<number, TimerEntry>()
  pump.onmessage = () => {
    const now = performance.now()
    for (const t of timers.values()) {
      if (now - t.last >= t.ms) {
        t.last = now
        try { t.fn(...t.args) } catch { /* keep pumping */ }
      }
    }
    const run = [...pendingRaf.values()]
    pendingRaf.clear()
    for (const cb of run) cb(now)
  }
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = nextId++
    pendingRaf.set(id, cb)
    return id
  }
  window.cancelAnimationFrame = (id: number) => {
    pendingRaf.delete(id)
  }
  // Overload-compatible setInterval/clearInterval replacements.
  ;(window as any).setInterval = (fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const id = nextId++
    timers.set(id, { fn, ms: ms ?? 0, last: performance.now(), args })
    return id
  }
  ;(window as any).clearInterval = (id?: number) => {
    if (id !== undefined) timers.delete(id)
  }
  console.log('[bgRaf] rAF + setInterval → worker pump (background-tab verification)')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
