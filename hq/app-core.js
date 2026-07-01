const PLATFORMS = [
  { id: 'ig', name: 'Instagram', icon: '📷', color: '#E1306C' },
  { id: 'tg', name: 'Telegram', icon: '✈️', color: '#0088cc' },
  { id: 'tt', name: 'TikTok', icon: '🎵', color: '#fe2c55' },
  { id: 'th', name: 'Threads', icon: '🧵', color: '#888' },
  { id: 'yt', name: 'YT Shorts', icon: '▶️', color: '#ff0000' },
  { id: 'fb', name: 'Facebook', icon: '📘', color: '#1877f2' },
];
const PLATFORM_BY_ID = Object.fromEntries(PLATFORMS.map(p => [p.id, p]));

RESTORE_IN_PROGRESS_DO_NOT_KEEP