const PLATFORMS = [
  { id: 'ig', name: 'Instagram', icon: '📷', color: '#E1306C' },
  { id: 'tg', name: 'Telegram', icon: '✈️', color: '#0088cc' },
  { id: 'tt', name: 'TikTok', icon: '🎵', color: '#fe2c55' },
  { id: 'th', name: 'Threads', icon: '🧵', color: '#888' },
  { id: 'yt', name: 'YT Shorts', icon: '▶️', color: '#ff0000' },
  { id: 'fb', name: 'Facebook', icon: '📘', color: '#1877f2' },
];
const PLATFORM_BY_ID = Object.fromEntries(PLATFORMS.map(p => [p.id, p]));

const STATUSES = [
  { id: 'draft', label: 'Чернетка', color: 'var(--grey)' },
  { id: 'in_work', label: 'В роботі', color: 'var(--blue)' },
  { id: 'review', label: 'На погодженні', color: 'var(--gold)' },
  { id: 'approved', label: 'Погоджено', color: 'var(--green-soft)' },
  { id: 'published', label: 'Опубліковано', color: 'var(--green)' },
  { id: 'rework', label: 'На доопрацюванні', color: 'var(--orange)' },
];
const STATUS_BY_ID = Object.fromEntries(STATUSES.map(s => [s.id, s]));

const CONTENT_TYPES = ['Пост', 'Reels', 'Сторис', 'Карусель', 'Лонгрід'];
const ROLES = [
  { id: 'ceo',    label: 'CEO',         tag: 'CEO' },
  { id: 'coo',    label: 'COO',         tag: 'COO' },
  { id: 'lead',   label: 'Тимлід SMM',  tag: 'Тимлід' },
  { id: 'member', label: 'SMM-учасник', tag: 'Учасник' },
];

PLACEHOLDER_LINE_STOP