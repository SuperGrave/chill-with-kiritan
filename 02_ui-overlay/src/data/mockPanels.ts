import type { NewsItem, SpotifyState, MemoItem, PersonalNewsState } from '../types/panels';

// Layout-testing stand-ins until the Companion App serves /api/state.
// Shapes follow types/panels.ts so the swap is data-only.

export const mockNews: NewsItem[] = [
  {
    id: 'n1',
    title: '新しいAIモデルが発表、より自然な対話が可能に',
    source: 'TECH WATCH',
    url: 'https://example.com/news/1',
    publishedAt: '2026-06-11T10:00:00+09:00',
    summary: '国内研究チームが対話特化の新モデルを公開。音声合成キャラクターとの組み合わせ事例も紹介された。',
  },
  {
    id: 'n2',
    title: '週末のイベント情報：中心部でフードフェス開催',
    source: 'LOCAL NEWS',
    url: 'https://example.com/news/2',
    publishedAt: '2026-06-11T09:30:00+09:00',
    summary: '東北の食材を集めた屋台が約60店舗出店。土日両日とも入場無料で、雨天決行とのこと。',
  },
  {
    id: 'n3',
    title: '本日の市場動向、ハイテク株が牽引',
    source: 'MARKET',
    url: 'https://example.com/news/3',
    publishedAt: '2026-06-11T08:15:00+09:00',
    summary: '半導体関連を中心に買いが先行。為替は小幅な値動きにとどまった。',
  },
  {
    id: 'n4',
    title: '次世代スマートグラスのプロトタイプが公開',
    source: 'TECH WATCH',
    url: 'https://example.com/news/4',
    publishedAt: '2026-06-11T07:00:00+09:00',
    summary: '重量は従来比40%減。視線入力とジェスチャー操作に対応し、来年の製品化を目指す。',
  },
  {
    id: 'n5',
    title: '梅雨入り前の晴天続く、週末は行楽日和に',
    source: 'WEATHER',
    url: 'https://example.com/news/5',
    publishedAt: '2026-06-11T06:30:00+09:00',
    summary: '高気圧に覆われ、東北地方は週末にかけて晴れの日が続く見込み。',
  },
];

export const mockNewsUpdatedAt = '2026-06-11T10:05:00+09:00';

export const mockPersonalNews: PersonalNewsState = {
  scripts: [{
    id: 'mock-personal-news',
    title: '昨日の俺流興味ニュース',
    fileName: 'mock-personal-news.txt',
    description: '歌詞なし時の代替表示プレビュー',
    chapterCount: 3,
    lineCount: 6,
    sourceCount: 2,
    supplementCount: 2,
    estimatedDurationMs: 60_000,
    modifiedAt: new Date().toISOString(),
  }],
  currentScript: {
    id: 'mock-personal-news',
    title: '昨日の俺流興味ニュース',
    fileName: 'mock-personal-news.txt',
    description: '歌詞なし時の代替表示プレビュー',
    chapters: [
      { id: 'chapter_001', title: '01 AIコーディング', lineIndex: 0, positionMs: 0 },
      { id: 'chapter_002', title: '02 AndroidとPC環境', lineIndex: 2, positionMs: 22_000 },
      { id: 'chapter_003', title: '03 ゲームと海の話', lineIndex: 4, positionMs: 43_000 },
    ],
    lines: [
      { id: 'line_001', kind: 'text', topic: '01 AIコーディング', text: 'きりたんメモです。AIコーディング系は便利さの裏側に、実行権限まわりの怖さも見えてきました。', durationMs: 10_000, sourceId: null, positionMs: 0 },
      { id: 'line_002', kind: 'text', topic: '01 AIコーディング', text: '知らないリポジトリをAIに読ませる時は、読むだけ・実行しない、の境界をちゃんと作りたいところですね。', durationMs: 12_000, sourceId: null, positionMs: 10_000 },
      { id: 'line_003', kind: 'text', topic: '02 AndroidとPC環境', text: 'Android 17のベータ周りは、壁紙やWebView系の検証にもじわっと関係してきそうです。', durationMs: 10_000, sourceId: null, positionMs: 22_000 },
      { id: 'line_004', kind: 'text', topic: '02 AndroidとPC環境', text: 'PCファーストで作って、段階的に実機へ持っていく方針はまだかなり相性がよさそうです。', durationMs: 11_000, sourceId: null, positionMs: 32_000 },
      { id: 'line_005', kind: 'text', topic: '03 ゲームと海の話', text: 'Switch 2や海事ニュースも、作業の横で流れてくると地味に楽しいやつです。', durationMs: 9_000, sourceId: null, positionMs: 43_000 },
      { id: 'line_006', kind: 'text', topic: '03 ゲームと海の話', text: '以上、歌詞がない曲の余白からお送りする、きりたん式の興味ニュースでした。', durationMs: 8_000, sourceId: null, positionMs: 52_000 },
    ],
    supplements: [
      { id: 'supplement_001', title: '01 AIコーディング / Agentic coding security report', text: 'Agentic coding security report', url: 'https://example.com/ai-coding-security', lineIndex: 1, chapterIndex: 0, positionMs: 10_000, durationMs: 6_000 },
      { id: 'supplement_002', title: '02 AndroidとPC環境 / Android Developers latest updates', text: 'Android Developers latest updates', url: 'https://developer.android.com/latest-updates', lineIndex: 3, chapterIndex: 1, positionMs: 32_000, durationMs: 6_000 },
    ],
    sources: [
      { id: 'source_001', title: 'Agentic coding security report', url: 'https://example.com/ai-coding-security', lineIndex: 1, chapterIndex: 0, positionMs: 10_000 },
      { id: 'source_002', title: 'Android Developers latest updates', url: 'https://developer.android.com/latest-updates', lineIndex: 3, chapterIndex: 1, positionMs: 32_000 },
    ],
    estimatedDurationMs: 60_000,
    modifiedAt: new Date().toISOString(),
  },
  selectedScriptId: 'mock-personal-news',
  status: 'playing',
  lineIndex: 0,
  lineStartedAt: new Date().toISOString(),
  lineElapsedMs: 0,
  elapsedMs: 0,
  durationMs: 60_000,
  currentChapterIndex: 0,
  loopEnabled: true,
  scriptDir: null,
  error: null,
  updatedAt: new Date().toISOString(),
};

export const mockSpotify: SpotifyState = {
  connected: true,
  status: 'playing',
  track: {
    id: 'mock-track',
    title: 'Chill Vibes Vol. 1',
    artist: 'Lofi Kiritan',
    album: 'Tohoku Tapes',
    albumArtUrl: undefined,
    durationMs: 225_000,
    progressMs: 83_000,
    sampledAt: new Date().toISOString(),
    isPlaying: true,
  },
  lyrics: {
    trackId: 'mock-track',
    source: 'LRCLIB',
    status: 'synced',
    synced: true,
    lines: [
      { time: 72, text: 'Soft keys glow in the evening light' },
      { time: 83, text: 'Kiritan hums along beside the screen' },
      { time: 94, text: 'Tiny words drift with the melody' },
    ],
    error: null,
  },
};

export const mockMemos: MemoItem[] = [
  {
    id: 'memo1',
    text: '・牛乳を買う\n・明日の会議の資料準備\n・観葉植物の水やり',
    pinned: true,
    createdAt: '2026-06-10T21:12:00+09:00',
    updatedAt: '2026-06-11T08:02:00+09:00',
  },
  {
    id: 'memo2',
    text: '壁紙の配色メモ：夜シーンは青寄り、朝は暖色のライトオーバーレイを試す',
    pinned: false,
    createdAt: '2026-06-09T23:40:00+09:00',
    updatedAt: '2026-06-09T23:40:00+09:00',
  },
  {
    id: 'memo3',
    text: 'VRMAモーション7本のうち、03と05をアイドル候補にする',
    pinned: false,
    createdAt: '2026-06-08T19:05:00+09:00',
    updatedAt: '2026-06-08T19:05:00+09:00',
  },
];
