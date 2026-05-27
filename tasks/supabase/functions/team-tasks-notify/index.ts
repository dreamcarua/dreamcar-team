// =====================================================================
// team-tasks-notify — Edge Function
// =====================================================================
// Обробляє чергу public.team_task_notifications:
// 1. claim_team_task_notifications(25) → pending → processing
// 2. форматує повідомлення під kind
// 3. шле через Telegram Bot API (TG_BOT_TOKEN)
// 4. опційно: email через Resend (RESEND_API_KEY) — якщо встановлено
// 5. mark_team_task_notification_done(id, channel, ok, err)
//
// Можна викликати:
//   а) з фронтенду після dispatch-події (POST з anon-key)
//   б) з Supabase Cron — pg_cron + http extension
//   в) з GitHub Action на schedule
//
// Secrets потрібні:
//   TG_BOT_TOKEN          — токен @dreamcar_team_bot
//   SUPABASE_URL          — задається автоматично
//   SUPABASE_SERVICE_ROLE_KEY — задається автоматично
//   TEAM_HUB_BASE         — наприклад 'https://team.dreamcar.ua'
//   RESEND_API_KEY        — опційно, для email
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const TG_BOT_TOKEN = Deno.env.get('TG_BOT_TOKEN') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? 'DreamCar Tasks <tasks@dreamcar.ua>';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TEAM_HUB_BASE = Deno.env.get('TEAM_HUB_BASE') ?? 'https://team.dreamcar.ua';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface Notification {
  id: string;
  recipient_id: string;
  task_id: string | null;
  comment_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
  channels: string[];
  attempts: number;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  telegram_username: string | null;
  tg_chat_id: string | null;
}

// ---------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------
const ICON: Record<string, string> = {
  assigned: '📌',
  unassigned: '➖',
  status_changed: '🔄',
  mention: '👋',
  comment: '💬',
  reminder_24h: '⏰',
  reminder_1h: '🚨',
  overdue: '🔥',
  daily_digest: '☀️',
  recurring_created: '🔁',
  dependency_done: '✅',
};

const STATUS_LABEL: Record<string, string> = {
  inbox: '📥 Inbox',
  doing: '⚙ Doing',
  review: '👀 Review',
  done: '✅ Done',
};

function fmtPriority(p?: string): string {
  return ({ p1: '🔴 P1', p2: '🟡 P2', p3: '🔵 P3', p4: '⚪ P4' } as Record<string, string>)[p ?? 'p3'] ?? '';
}

function fmtDue(d?: string): string {
  if (!d) return '';
  const due = new Date(d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dueDay = new Date(due); dueDay.setHours(0, 0, 0, 0);
  const days = Math.round((dueDay.getTime() - today.getTime()) / 86400000);
  const dateStr = `${String(due.getDate()).padStart(2, '0')}.${String(due.getMonth() + 1).padStart(2, '0')}`;
  if (days < 0) return `🔥 <b>прострочено</b> (${dateStr}, ${-days} дн.)`;
  if (days === 0) return `⏰ <b>сьогодні</b> (${dateStr})`;
  if (days === 1) return `⏰ <b>завтра</b> (${dateStr})`;
  return `📅 ${dateStr} (через ${days} дн.)`;
}

function escapeTg(s: string): string {
  return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
}

function taskUrl(task_id: string): string {
  return `${TEAM_HUB_BASE}/tasks/#task=${task_id}`;
}

function formatMessage(n: Notification, recipient: UserRow, author: UserRow | null): string {
  const p = n.payload as Record<string, string>;
  const icon = ICON[n.kind] ?? '🔔';
  const title = p.task_title ?? p.title ?? '(без назви)';
  const url = n.task_id ? taskUrl(n.task_id) : TEAM_HUB_BASE + '/tasks/';
  const link = (txt: string) => `<a href="${url}">${escapeTg(txt)}</a>`;
  const authorName = author?.name ? escapeTg(author.name) : 'хтось з команди';

  switch (n.kind) {
    case 'assigned':
      return `${icon} <b>Тобі призначено завдання</b>\n\n${link(title)}\n${fmtPriority(p.priority)} ${STATUS_LABEL[p.status] ?? ''}\n${fmtDue(p.due_date)}`;
    case 'unassigned':
      return `${icon} <b>З тебе зняли завдання</b>\n\n${link(title)}`;
    case 'status_changed':
      return `${icon} <b>Статус змінив${author ? ' ' + authorName : ''}</b>\n\n${link(title)}\n${STATUS_LABEL[p.old_status] ?? p.old_status} → <b>${STATUS_LABEL[p.status] ?? p.status}</b>`;
    case 'mention':
      return `${icon} <b>${authorName} тебе тегнув</b>\n\n${link(title)}\n${escapeTg((p.snippet ?? '').toString())}`;
    case 'comment':
      return `${icon} <b>${authorName} додав коментар</b>\n\n${link(title)}\n${escapeTg((p.snippet ?? '').toString())}`;
    case 'reminder_24h':
      return `${icon} <b>Дедлайн завтра</b>\n\n${link(title)}\n${fmtPriority(p.priority)} ${fmtDue(p.due_date)}`;
    case 'reminder_1h':
      return `${icon} <b>Дедлайн через годину</b>\n\n${link(title)}`;
    case 'overdue':
      return `${icon} <b>Завдання прострочено</b>\n\n${link(title)}\n${fmtDue(p.due_date)}`;
    case 'dependency_done': {
      const bl = p.blocker_title ?? '(блокер)';
      return `${icon} <b>Розблоковано: «${escapeTg(bl.toString())}» закрито</b>\n\nТепер можна братися за: ${link(title)}`;
    }
    case 'daily_digest': {
      const items = (n.payload.items as Array<Record<string, string>>) ?? [];
      if (!items.length) return `${icon} <b>Дайджест ранку</b>\n\nЗадач без дедлайну і прострочених немає. Гарного дня!`;
      const lines = items.map(it => {
        const due = fmtDue(it.due_date);
        return `• <a href="${taskUrl(it.id)}">${escapeTg(it.title)}</a> ${fmtPriority(it.priority)} ${due}`;
      }).join('\n');
      return `${icon} <b>Доброго ранку, ${escapeTg(recipient.name?.split(' ')[0] ?? '')}!</b>\nТвої задачі на сьогодні:\n\n${lines}\n\n<a href="${TEAM_HUB_BASE}/tasks/">Відкрити Tasks →</a>`;
    }
    case 'recurring_created':
      return `${icon} <b>Створено повторюване завдання</b>\n\n${link(title)}\n${fmtDue(p.due_date)}`;
    default:
      return `${icon} <b>Tasks</b>: ${escapeTg(title)}`;
  }
}

// ---------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------
async function sendTelegram(
  chatId: string,
  text: string,
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>,
): Promise<{ ok: boolean; err?: string }> {
  if (!TG_BOT_TOKEN) return { ok: false, err: 'no_TG_BOT_TOKEN' };
  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    };
    if (inlineKeyboard && inlineKeyboard.length) {
      body.reply_markup = { inline_keyboard: inlineKeyboard };
    }
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok) return { ok: false, err: j.description ?? 'tg_unknown' };
    return { ok: true };
  } catch (e) {
    return { ok: false, err: (e as Error).message };
  }
}

// Build inline keyboard для task notification (assigned/reminder/overdue)
function buildTaskKeyboard(taskId: string | null, kind: string): Array<Array<{ text: string; callback_data: string }>> | undefined {
  if (!taskId) return undefined;
  // Quick actions для actionable notifications
  if (['assigned', 'reminder_24h', 'reminder_1h', 'overdue', 'recurring_created', 'mention', 'comment'].includes(kind)) {
    return [
      [
        { text: '✅ Готово', callback_data: `task:done:${taskId}` },
        { text: '▶ В роботу', callback_data: `task:doing:${taskId}` },
      ],
      [
        { text: '👀 Відкрити', callback_data: `task:open:${taskId}` },
      ],
    ];
  }
  return undefined;
}

async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; err?: string }> {
  if (!RESEND_API_KEY) return { ok: false, err: 'no_RESEND_API_KEY' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
    });
    if (!r.ok) {
      const t = await r.text();
      return { ok: false, err: `resend_${r.status}: ${t.slice(0, 120)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, err: (e as Error).message };
  }
}

// ---------------------------------------------------------------------
// Main worker
// ---------------------------------------------------------------------
async function processBatch(limit = 25): Promise<{ processed: number; sent_tg: number; sent_email: number; errors: number }> {
  const stats = { processed: 0, sent_tg: 0, sent_email: 0, errors: 0 };

  const { data: claimed, error: claimErr } = await supabase.rpc('claim_team_task_notifications', { p_limit: limit });
  if (claimErr) {
    console.error('[notify] claim error:', claimErr);
    return stats;
  }
  if (!claimed || !claimed.length) return stats;

  // hydrate recipients + authors in batch
  const recipientIds = [...new Set(claimed.map((n: Notification) => n.recipient_id))];
  const authorIds = [...new Set(
    claimed.map((n: Notification) => (n.payload as { author_id?: string }).author_id).filter(Boolean) as string[]
  )];
  const allUserIds = [...new Set([...recipientIds, ...authorIds])];

  const { data: users } = await supabase
    .from('users')
    .select('id, email, name, telegram_username, tg_chat_id, is_active')
    .in('id', allUserIds);
  const usersById = new Map<string, UserRow>();
  for (const u of (users ?? []) as UserRow[]) usersById.set(u.id, u);

  // also fetch prefs (quiet hours, channels)
  const { data: prefs } = await supabase
    .from('team_task_user_prefs')
    .select('user_id, tg_enabled, email_enabled, quiet_from, quiet_to')
    .in('user_id', recipientIds);
  const prefsById = new Map<string, { tg_enabled: boolean; email_enabled: boolean; quiet_from: number; quiet_to: number }>();
  for (const p of (prefs ?? [])) prefsById.set(p.user_id, p);

  const nowHourCET = parseInt(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/Warsaw' }), 10);

  for (const n of claimed as Notification[]) {
    stats.processed++;
    const recipient = usersById.get(n.recipient_id);
    if (!recipient) {
      await supabase.rpc('mark_team_task_notification_done', { p_id: n.id, p_channel: 'tg', p_ok: false, p_error: 'no_recipient' });
      stats.errors++;
      continue;
    }
    const author = (n.payload as { author_id?: string }).author_id ? usersById.get((n.payload as { author_id: string }).author_id) ?? null : null;
    const pref = prefsById.get(n.recipient_id);
    const tgEnabled = pref ? pref.tg_enabled : true;
    const emailEnabled = pref ? pref.email_enabled : false;
    const qFrom = pref?.quiet_from ?? 22;
    const qTo = pref?.quiet_to ?? 8;
    const isQuiet = qFrom > qTo
      ? (nowHourCET >= qFrom || nowHourCET < qTo)
      : (nowHourCET >= qFrom && nowHourCET < qTo);
    // urgent kinds bypass quiet hours
    const urgent = ['mention', 'overdue', 'reminder_1h'].includes(n.kind);
    if (isQuiet && !urgent && n.kind !== 'daily_digest') {
      // re-schedule for after quiet hours (qTo today or tomorrow)
      const target = new Date();
      target.setHours(qTo, 0, 0, 0);
      if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
      await supabase.from('team_task_notifications')
        .update({ state: 'pending', next_attempt_at: target.toISOString() })
        .eq('id', n.id);
      continue;
    }

    const text = formatMessage(n, recipient, author);

    // -------- TG --------
    if (tgEnabled && n.channels.includes('tg') && recipient.tg_chat_id) {
      const keyboard = buildTaskKeyboard(n.task_id, n.kind);
      const res = await sendTelegram(recipient.tg_chat_id, text, keyboard);
      if (res.ok) stats.sent_tg++;
      else stats.errors++;
      await supabase.rpc('mark_team_task_notification_done', {
        p_id: n.id, p_channel: 'tg', p_ok: res.ok, p_error: res.err ?? null,
      });
    } else {
      // mark TG as skipped if no chat_id or disabled
      await supabase.rpc('mark_team_task_notification_done', {
        p_id: n.id, p_channel: 'tg', p_ok: true, p_error: 'skip_no_chat_id_or_disabled',
      });
    }

    // -------- EMAIL (опціонально) --------
    if (emailEnabled && n.channels.includes('email') && recipient.email && RESEND_API_KEY) {
      const subject = `[Tasks] ${({
        assigned: 'Тобі призначено завдання',
        status_changed: 'Зміна статусу',
        mention: 'Тебе тегнули',
        comment: 'Новий коментар',
        reminder_24h: 'Дедлайн завтра',
        overdue: 'Завдання прострочено',
        daily_digest: 'Дайджест ранку',
      } as Record<string, string>)[n.kind] ?? 'Нотифікація'}`;
      const html = `<div style="font-family:Manrope,sans-serif;color:#0A0A0A">${
        text.replace(/\n/g, '<br>')
      }<hr><div style="font-size:11px;color:#888">DreamCar Team Hub · <a href="${TEAM_HUB_BASE}/tasks/">tasks.dreamcar.ua</a></div></div>`;
      const r = await sendEmail(recipient.email, subject, html);
      if (r.ok) stats.sent_email++;
      await supabase.rpc('mark_team_task_notification_done', { p_id: n.id, p_channel: 'email', p_ok: r.ok, p_error: r.err ?? null });
    }
  }

  return stats;
}

// ---------------------------------------------------------------------
// HTTP entrypoint
// ---------------------------------------------------------------------
Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get('limit') ?? '25', 10);
    const result = await processBatch(Math.min(limit, 100));
    return new Response(JSON.stringify({ ok: true, ...result, ts: new Date().toISOString() }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    console.error('[notify] fatal:', e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
});
