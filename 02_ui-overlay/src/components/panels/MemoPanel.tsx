import React from 'react';
import { Pin } from 'lucide-react';
import type { MemoItem } from '../../types/panels';
import { mockMemos } from '../../data/mockPanels';
import { memoPanelDefaults } from '../../config/uiSettings';
import { clampLines } from './shared';

interface MemoPanelProps {
  memos?: MemoItem[];
  settings?: any;
}

const formatDateHM = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--/-- --:--';
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mo}/${da} ${h}:${mi}`;
};

const SectionLabel: React.FC<{ icon?: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    fontWeight: 'bold',
    letterSpacing: '0.15em',
    opacity: 0.7,
    marginBottom: '10px',
  }}>
    {icon}
    {children}
  </div>
);

const MemoPanel: React.FC<MemoPanelProps> = ({ memos = mockMemos, settings }) => {
  const s = { ...memoPanelDefaults, ...settings };

  const limited = s.maxItems > 0 ? memos.slice(0, s.maxItems) : memos;
  const pinned = s.showPinnedSection ? limited.filter((m) => m.pinned) : [];
  const rest = s.showPinnedSection ? limited.filter((m) => !m.pinned) : limited;

  const renderCard = (memo: MemoItem) => (
    <div
      key={memo.id}
      style={{
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderLeft: memo.pinned ? '3px solid rgba(255,255,255,0.4)' : '1px solid rgba(255,255,255,0.1)',
        borderRadius: '8px',
        padding: `${s.cardPadding}px`,
      }}
    >
      <div style={{
        fontSize: `${s.textSize}px`,
        lineHeight: 1.7,
        letterSpacing: '0.03em',
        whiteSpace: 'pre-wrap',
        opacity: 0.92,
        ...clampLines(s.maxLines),
      }}>
        {memo.text}
      </div>
      {s.showDates && (
        <div style={{
          marginTop: '10px',
          fontSize: `${s.dateSize}px`,
          letterSpacing: '0.12em',
          opacity: 0.45,
        }}>
          @ UPDATED: {formatDateHM(memo.updatedAt)}
        </div>
      )}
    </div>
  );

  return (
    <div style={{
      color: '#fff',
      fontFamily: 'var(--font-main)',
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100%',
      boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: `${s.cardGap}px` }}>
        {pinned.length > 0 && (
          <div>
            <SectionLabel icon={<Pin size={13} strokeWidth={2} />}>PINNED</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: `${s.cardGap}px` }}>
              {pinned.map(renderCard)}
            </div>
          </div>
        )}

        {rest.length > 0 && (
          <div>
            {pinned.length > 0 && <SectionLabel>NOTES</SectionLabel>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: `${s.cardGap}px` }}>
              {rest.map(renderCard)}
            </div>
          </div>
        )}

        {limited.length === 0 && (
          <div style={{ opacity: 0.4, letterSpacing: '0.1em', fontSize: '14px' }}>
            NO MEMOS
          </div>
        )}
      </div>

      {s.showFooter && (
        <div style={{
          marginTop: 'auto',
          paddingTop: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '15px',
          letterSpacing: '0.1em',
          opacity: 0.9,
        }}>
          <span>@ {limited.length} MEMOS</span>
          {pinned.length > 0 && <span style={{ opacity: 0.6 }}>/ {pinned.length} PINNED</span>}
        </div>
      )}
    </div>
  );
};

export default MemoPanel;
