import React from 'react';
import { Send } from 'lucide-react';
import type { AiState } from '../../types/panels';
import { mockAi } from '../../data/mockPanels';
import { aiPanelDefaults } from '../../config/uiSettings';
import { StatusBadge, formatTimeHM } from './shared';

interface AiPanelProps {
  ai?: AiState;
  settings?: any;
}

const AiPanel: React.FC<AiPanelProps> = ({ ai = mockAi, settings }) => {
  const s = { ...aiPanelDefaults, ...settings };

  const statusTone =
    ai.status === 'error' ? 'error'
    : ai.status === 'thinking' ? 'warn'
    : ai.status === 'responding' ? 'ok'
    : 'neutral';

  return (
    <div style={{
      color: '#fff',
      fontFamily: 'var(--font-main)',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      boxSizing: 'border-box',
    }}>
      {s.showStatus && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          paddingBottom: '14px',
          marginBottom: '14px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          fontSize: '15px',
          letterSpacing: '0.1em',
          opacity: 0.9,
          flexShrink: 0,
        }}>
          <span>@ {ai.provider === 'none' ? 'NO PROVIDER' : ai.provider.toUpperCase()}</span>
          <StatusBadge tone={statusTone}>STATUS: {ai.status.toUpperCase()}</StatusBadge>
          {ai.error && <StatusBadge tone="error">ERROR</StatusBadge>}
        </div>
      )}

      <div style={{
        flexGrow: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: `${s.msgGap}px`,
        paddingRight: '8px',
        minHeight: 0,
      }}>
        {ai.messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div key={msg.id} style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: isUser ? 'flex-end' : 'flex-start',
            }}>
              {(s.showLabels || s.showTimestamps) && (
                <div style={{
                  display: 'flex',
                  gap: '10px',
                  marginBottom: '5px',
                  fontSize: `${s.labelSize}px`,
                  letterSpacing: '0.15em',
                }}>
                  {s.showLabels && (
                    <span style={{ opacity: 0.75 }}>{isUser ? 'YOU' : 'KIRITAN'}</span>
                  )}
                  {s.showTimestamps && (
                    <span style={{ fontSize: `${s.timeSize}px`, opacity: 0.4 }}>
                      {formatTimeHM(msg.createdAt)}
                    </span>
                  )}
                </div>
              )}

              {isUser ? (
                <div style={{
                  maxWidth: '85%',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  borderTopRightRadius: '4px',
                  background: `rgba(255,255,255,${s.bubbleOpacity})`,
                  border: '1px solid rgba(255,255,255,0.12)',
                  fontSize: `${s.textSize}px`,
                  lineHeight: 1.6,
                  letterSpacing: '0.03em',
                }}>
                  {msg.text}
                </div>
              ) : (
                <div style={{
                  maxWidth: '92%',
                  borderLeft: '3px solid rgba(255,255,255,0.4)',
                  paddingLeft: '12px',
                  fontSize: `${s.textSize}px`,
                  lineHeight: 1.7,
                  letterSpacing: '0.03em',
                  opacity: 0.9,
                }}>
                  {msg.text}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {s.showInput && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexShrink: 0 }}>
          <input
            type="text"
            placeholder="MESSAGE TO KIRITAN..."
            style={{
              flexGrow: 1,
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '8px',
              padding: '12px 16px',
              color: '#fff',
              outline: 'none',
              fontFamily: 'var(--font-main)',
              fontSize: `${s.textSize}px`,
              letterSpacing: '0.05em',
            }}
          />
          <button style={{
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '8px',
            width: '46px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            cursor: 'pointer',
          }}>
            <Send size={18} strokeWidth={1.5} />
          </button>
        </div>
      )}
    </div>
  );
};

export default AiPanel;
