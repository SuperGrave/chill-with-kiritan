import React from 'react';
import type { NewsItem } from '../../types/panels';
import { mockNews, mockNewsUpdatedAt } from '../../data/mockPanels';
import { newsPanelDefaults } from '../../config/uiSettings';
import { StatusBadge, clampLines, formatTimeHM } from './shared';

interface NewsPanelProps {
  items?: NewsItem[];
  updatedAt?: string;
  source?: 'live' | 'mock' | 'offline' | 'demo';
  settings?: any;
}

const NewsPanel: React.FC<NewsPanelProps> = ({
  items = mockNews,
  updatedAt = mockNewsUpdatedAt,
  source = 'mock',
  settings,
}) => {
  const s = { ...newsPanelDefaults, ...settings };
  const shown = s.maxItems > 0 ? items.slice(0, s.maxItems) : items;
  const titleOverflowStyle: React.CSSProperties = s.singleLineTitle
    ? {
        display: 'block',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }
    : clampLines(s.maxTitleLines);

  return (
    <div style={{
      color: '#fff',
      fontFamily: 'var(--font-main)',
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100%',
      boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: `${s.itemGap}px` }}>
        {shown.length === 0 && (
          <div style={{ opacity: 0.5, letterSpacing: '0.12em', fontSize: '14px' }}>
            NO NEWS ITEMS
          </div>
        )}
        {shown.map((item, i) => {
          const latest = s.highlightLatest && i === 0;
          const titleLeftMeta = s.metaPlacement === 'titleLeft';
          const showTextMeta = s.showTime || (s.showSource && item.source);
          const showMeta = showTextMeta || latest;
          return (
            <div
              key={item.id}
              style={{
                display: 'flex',
                gap: '14px',
                paddingBottom: s.showDivider && i < shown.length - 1 ? `${s.itemGap}px` : 0,
                borderBottom: s.showDivider && i < shown.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                borderLeft: latest ? '3px solid rgba(255,255,255,0.4)' : '3px solid transparent',
                paddingLeft: '12px',
                marginLeft: '-15px',
              }}
            >
              {s.showIndex && (
                <div style={{
                  fontSize: `${s.indexSize}px`,
                  fontWeight: 300,
                  lineHeight: 1,
                  opacity: latest ? 0.7 : 0.35,
                  letterSpacing: '0.05em',
                  minWidth: `${s.indexSize * 1.3}px`,
                  paddingTop: '2px',
                }}>
                  {String(i + 1).padStart(2, '0')}
                </div>
              )}

              <div style={{ flex: 1, minWidth: 0 }}>
                {showMeta && !titleLeftMeta && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    marginBottom: '6px',
                    fontSize: `${s.timeSize}px`,
                    letterSpacing: '0.1em',
                  }}>
                    {s.showTime && (
                      <span style={{ opacity: latest ? 0.95 : 0.55 }}>
                        {formatTimeHM(item.publishedAt)}
                      </span>
                    )}
                    {s.showSource && item.source && (
                      <span style={{ opacity: 0.5, fontSize: '0.85em', letterSpacing: '0.15em' }}>
                        {item.source}
                      </span>
                    )}
                    {latest && (
                      <span style={{ marginLeft: 'auto' }}>
                        <StatusBadge tone="neutral">LATEST</StatusBadge>
                      </span>
                    )}
                  </div>
                )}

                {titleLeftMeta ? (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', minWidth: 0 }}>
                    {showTextMeta && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        flexShrink: 0,
                        fontSize: `${s.timeSize}px`,
                        letterSpacing: '0.1em',
                        opacity: latest ? 0.92 : 0.58,
                      }}>
                        {s.showTime && <span>{formatTimeHM(item.publishedAt)}</span>}
                        {s.showSource && item.source && (
                          <span style={{ fontSize: '0.85em', letterSpacing: '0.15em' }}>{item.source}</span>
                        )}
                      </div>
                    )}
                    <div style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: `${s.titleSize}px`,
                      lineHeight: 1.5,
                      letterSpacing: '0.03em',
                      opacity: 0.95,
                      ...titleOverflowStyle,
                    }}>
                      {item.title}
                    </div>
                    {latest && (
                      <span style={{ flexShrink: 0 }}>
                        <StatusBadge tone="neutral">LATEST</StatusBadge>
                      </span>
                    )}
                  </div>
                ) : (
                  <div style={{
                    fontSize: `${s.titleSize}px`,
                    lineHeight: 1.5,
                    letterSpacing: '0.03em',
                    opacity: 0.95,
                    ...titleOverflowStyle,
                  }}>
                    {item.title}
                  </div>
                )}

                {s.showSummary && item.summary && (
                  <div style={{
                    fontSize: `${s.summarySize}px`,
                    lineHeight: 1.6,
                    letterSpacing: '0.03em',
                    opacity: 0.55,
                    marginTop: '6px',
                    ...clampLines(s.maxSummaryLines),
                  }}>
                    {item.summary}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {s.showFooter && (
        <div style={{
          marginTop: 'auto',
          paddingTop: '20px',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          fontSize: `${s.footerSize}px`,
          letterSpacing: '0.1em',
          opacity: 0.9,
        }}>
          <span>@ {shown.length} ITEMS</span>
          <span>@ UPDATED: {formatTimeHM(updatedAt)}</span>
          <StatusBadge tone={source === 'live' ? 'ok' : 'warn'}>
            SOURCE: {source.toUpperCase()}
          </StatusBadge>
        </div>
      )}
    </div>
  );
};

export default NewsPanel;
