import { useEffect, useState } from 'react';
import { timerPanelDefaults } from '../../config/uiSettings';
import type { CompanionTimerState } from '../../services/companionClient';

type TimerPhase = 'focus' | 'shortBreak' | 'longBreak';
type TimerAction = 'start' | 'pause' | 'reset' | 'toggle' | 'next';

const validPhase = (phase: unknown): TimerPhase =>
  phase === 'shortBreak' || phase === 'longBreak' ? phase : 'focus';

const formatMs = (ms: number) => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const startedAtMs = (value?: string | null): number | null => {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
};

function durationForPhase(settings: any, phase: TimerPhase): number {
  if (settings.mode === 'timer') return Math.max(1, settings.timerMinutes ?? timerPanelDefaults.timerMinutes) * 60_000;
  if (phase === 'shortBreak') return Math.max(1, settings.shortBreakMinutes ?? timerPanelDefaults.shortBreakMinutes) * 60_000;
  if (phase === 'longBreak') return Math.max(1, settings.longBreakMinutes ?? timerPanelDefaults.longBreakMinutes) * 60_000;
  return Math.max(1, settings.pomodoroMinutes ?? timerPanelDefaults.pomodoroMinutes) * 60_000;
}

function titleFor(settings: any, mode: string, phase: TimerPhase): string {
  if (mode === 'timer') return settings.timerTitle ?? timerPanelDefaults.timerTitle;
  if (phase === 'shortBreak') return settings.shortBreakTitle ?? timerPanelDefaults.shortBreakTitle;
  if (phase === 'longBreak') return settings.longBreakTitle ?? timerPanelDefaults.longBreakTitle;
  return settings.focusTitle ?? timerPanelDefaults.focusTitle;
}

function labelFor(settings: any, mode: string, phase: TimerPhase): string {
  if (mode === 'timer') return settings.timerLabel ?? timerPanelDefaults.timerLabel;
  if (phase === 'shortBreak') return settings.shortBreakLabel ?? timerPanelDefaults.shortBreakLabel;
  if (phase === 'longBreak') return settings.longBreakLabel ?? timerPanelDefaults.longBreakLabel;
  return settings.focusLabel ?? timerPanelDefaults.focusLabel;
}

function liveRemaining(timer: CompanionTimerState, now: number): number {
  const base = Math.max(0, Number(timer.remainingMs ?? 0));
  if (timer.status !== 'running') return base;
  const started = startedAtMs(timer.startedAt);
  if (!started) return base;
  return Math.max(0, base - Math.max(0, now - started));
}

export default function TimerPanel({
  settings,
  timer,
  offline = false,
  onControl,
}: {
  settings?: any;
  timer?: CompanionTimerState | null;
  offline?: boolean;
  onControl?: (action: TimerAction) => Promise<boolean>;
}) {
  const s = { ...timerPanelDefaults, ...(settings ?? {}) };
  const [phase, setPhase] = useState<TimerPhase>('focus');
  const [cycle, setCycle] = useState(1);
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(() => durationForPhase(s, 'focus'));
  const [now, setNow] = useState(Date.now());

  const useRemote = !!timer && !offline;
  const displayedPhase = useRemote ? validPhase(timer?.phase) : phase;
  const displayedMode = useRemote ? timer?.mode ?? s.mode : s.mode;
  const displayedCycle = useRemote ? Math.max(1, timer?.cycle ?? 1) : cycle;
  const displayedRunning = useRemote ? timer?.status === 'running' : running;
  const displayedRemaining = useRemote && timer ? liveRemaining(timer, now) : remaining;
  const displayedDuration = useRemote
    ? Math.max(1, Number(timer?.durationMs ?? durationForPhase(s, displayedPhase)))
    : durationForPhase(s, displayedPhase);
  const progress = displayedDuration > 0 ? 1 - displayedRemaining / displayedDuration : 0;
  const barHeight = Math.max(1, Number(s.barHeight ?? timerPanelDefaults.barHeight) || timerPanelDefaults.barHeight);
  const barBorderWidth = Math.max(1, Math.round(barHeight / 10));
  const itemGap = Math.max(0, Number(s.itemGap ?? timerPanelDefaults.itemGap) || 0);

  useEffect(() => {
    setRunning(false);
    setPhase('focus');
    setCycle(1);
    setRemaining(durationForPhase(s, 'focus'));
  }, [s.mode, s.timerMinutes, s.pomodoroMinutes, s.shortBreakMinutes, s.longBreakMinutes]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setRemaining((prev) => {
        const next = prev - 1000;
        if (next > 0) return next;
        if (s.mode === 'timer') {
          setRunning(false);
          return 0;
        }
        const nextCycle = phase === 'focus' ? cycle + 1 : cycle;
        const nextPhase: TimerPhase =
          phase === 'focus'
            ? (cycle % 4 === 0 ? 'longBreak' : 'shortBreak')
            : 'focus';
        if (phase === 'focus') setCycle(nextCycle);
        setPhase(nextPhase);
        return durationForPhase(s, nextPhase);
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, s.mode, phase, cycle, s.timerMinutes, s.pomodoroMinutes, s.shortBreakMinutes, s.longBreakMinutes]);

  useEffect(() => {
    if (!useRemote || timer?.status !== 'running') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [useRemote, timer?.status, timer?.startedAt, timer?.commandSeq]);

  const reset = () => {
    setRunning(false);
    setPhase('focus');
    setCycle(1);
    setRemaining(durationForPhase(s, 'focus'));
  };

  const control = (action: TimerAction) => {
    if (useRemote && onControl) {
      void onControl(action);
      return;
    }
    if (action === 'reset') {
      reset();
    } else if (action === 'toggle' || action === 'start' || action === 'pause') {
      setRunning((v) => action === 'start' ? true : action === 'pause' ? false : !v);
    } else if (action === 'next') {
      if (s.mode === 'timer') {
        reset();
        return;
      }
      const nextCycle = phase === 'focus' ? cycle + 1 : cycle;
      const nextPhase: TimerPhase = phase === 'focus' ? (cycle % 4 === 0 ? 'longBreak' : 'shortBreak') : 'focus';
      if (phase === 'focus') setCycle(nextCycle);
      setPhase(nextPhase);
      setRemaining(durationForPhase(s, nextPhase));
    }
  };

  return (
    <div className="timer-panel" style={{ gap: `${itemGap}px` }}>
      <div className="timer-panel-meta" style={{ fontSize: s.metaSize }}>
        <span>{labelFor(s, displayedMode, displayedPhase)}</span>
        {s.showCycle !== false && displayedMode !== 'timer' && <span>SET {String(displayedCycle).padStart(2, '0')}</span>}
      </div>
      <div className="timer-panel-title" style={{ fontSize: s.titleSize }}>
        {titleFor(s, displayedMode, displayedPhase)}
      </div>
      <div className="timer-panel-time" style={{ fontSize: s.timeSize }}>{formatMs(displayedRemaining)}</div>
      <div
        className="timer-panel-track"
        style={{
          height: `${barHeight}px`,
          minHeight: `${barHeight}px`,
          flexBasis: `${barHeight}px`,
          borderWidth: `${barBorderWidth}px`,
        }}
        aria-hidden="true"
      >
        <span style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
      </div>
      {s.showControls !== false && (
        <div className="timer-panel-controls">
          <button type="button" onClick={() => control('toggle')}>{displayedRunning ? 'PAUSE' : 'START'}</button>
          <button type="button" onClick={() => control('reset')}>RESET</button>
          <button type="button" onClick={() => control('next')}>NEXT</button>
        </div>
      )}
    </div>
  );
}
