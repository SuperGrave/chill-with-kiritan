import type { NewsItem, AiState, SpotifyState, MemoItem } from '../types/panels';

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

export const mockSpotify: SpotifyState = {
  connected: true,
  status: 'playing',
  track: {
    title: 'Chill Vibes Vol. 1',
    artist: 'Lofi Kiritan',
    album: 'Tohoku Tapes',
    albumArtUrl: undefined,
    durationMs: 225_000,
    progressMs: 83_000,
  },
};

export const mockAi: AiState = {
  provider: 'openai',
  status: 'idle',
  messages: [
    { id: 'm1', role: 'user', text: '明日の天気は？', createdAt: '2026-06-11T09:41:00+09:00' },
    {
      id: 'm2',
      role: 'assistant',
      text: '明日の札幌は晴れのち曇りですね。最高気温は22度くらいの予報です。お出かけ日和かもしれませんよ。',
      createdAt: '2026-06-11T09:41:08+09:00',
    },
    { id: 'm3', role: 'user', text: 'ありがとう。', createdAt: '2026-06-11T09:42:00+09:00' },
    {
      id: 'm4',
      role: 'assistant',
      text: 'どういたしまして！他に知りたいことはありますか？',
      createdAt: '2026-06-11T09:42:05+09:00',
    },
  ],
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
