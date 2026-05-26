// =====================================================================
// team-tasks-cron — Edge Function
// =====================================================================
// Запускається кожні 30 хв через Supabase Cron (pg_cron + http extension)
// або через GitHub Actions.
//
// Що робить:
//   • 09:00 (CET) — Daily digest для assignees, у кого є open tasks на сьогодні
//                   або прострочені. one-shot через last_digest_sent_on.
//   • Кожні 30 хв — reminder_24h для tasks де due_date = tomorrow,
//                   reminder_1h для tasks де completed_at < 1h until due_date.
//   • Кожну годину — overdue: due_date < today, status != done,
//                   last_overdue_sent_at > 24h тому (щоб не спамити).
//   • Раз на день — recurring: створює новий екземпляр для рутинних задач.
//
// Після queueing → одразу викликає team-tasks-notify (внутрішнім fetch),
// щоб черга обробилась без додаткового кроку.
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const NOTIFY_URL = Deno.env.get('NOTIFY_FN_URL') ?? `${SUPABASE_URL}/functions/v1/team-tasks-notify`;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface Task {
  id: string;
  title: string;
  priority: string;
  status: string;
  assignee_id: string | null;
  due_date: string | null;
  recurrence: string | null;
  last_reminder_sent_at: string | null;
  last_overdue_sent_at: string | null;
  last_digest_sent_on: string | null;
}

function tomorrowISO(): string {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function getCETHour(): number {
  return parseInt(
    new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/Warsaw' }),
    10,
  );
}

// ---------------------------------------------------------------------
// 1. Reminders 24h before due
// ---------------------------------------------------------------------
async function enqueueReminders24h(): Promise<number> {
  const tomorrow = tomorrowISO();
  const { data: tasks } = await supabase
    .from('team_tasks')
    .select('id, title, priority, status, assignee_id, due_date, last_reminder_sent_at')
    .eq('due_date', tomorrow)
    .neq('status', 'done')
    .not('assignee_id', 'is', null);

  let queued = 0;
  for (const t of (tasks ?? []) as Task[]) {
    // не дублюємо в межах 12 годин
    if (t.last_reminder_sent_at && Date.now() - new Date(t.last_reminder_sent_at).getTime() < 12 * 3600 * 1000) continue;
    const { error } = await supabase.rpc('enqueue_team_task_notification', {
      p_recipient: t.assignee_id,
      p_task: t.id,
      p_kind: 'reminder_24h',
      p_payload: {
        title: t.title, priority: t.priority, status: t.status, due_date: t.due_date,
      },
      p_dedupe: `r24:${t.id}:${tomorrow}`,
    });
    if (!error) {
      await supabase.from('team_tasks').update({ last_reminder_sent_at: new Date().toISOString() }).eq('id', t.id);
      queued++;
    }
  }
  return queued;
}

// ---------------------------------------------------------------------
// 2. Overdue
// ---------------------------------------------------------------------
async function enqueueOverdue(): Promise<number> {
  const today = todayISO();
  const { data: tasks } = await supabase
    .from('team_tasks')
    .select('id, title, priority, status, assignee_id, due_date, last_overdue_sent_at')
    .lt('due_date', today)
    .neq('status', 'done')
    .not('assignee_id', 'is', null);

  let queued = 0;
  for (const t of (tasks ?? []) as Task[]) {
    // тільки раз на 24h
    if (t.last_overdue_sent_at && Date.now() - new Date(t.last_overdue_sent_at).getTime() < 24 * 3600 * 1000) continue;
    const { error } = await supabase.rpc('enqueue_team_task_notification', {
      p_recipient: t.assignee_id,
      p_task: t.id,
      p_kind: 'overdue',
      p_payload: { title: t.title, priority: t.priority, status: t.status, due_date: t.due_date },
      p_dedupe: `over:${t.id}:${today}`,
    });
    if (!error) {
      await supabase.from('team_tasks').update({ last_overdue_sent_at: new Date().toISOString() }).eq('id', t.id);
      queued++;
    }
  }
  return queued;
}

// ---------------------------------------------------------------------
// 3. Daily digest at 09 CET — групуємо по assignee_id
// ---------------------------------------------------------------------
async function enqueueDailyDigest(): Promise<number> {
  const hour = getCETHour();
  // запускаємо тільки у вікно 09:00-10:00 CET
  if (hour < 9 || hour >= 10) return 0;
  const today = todayISO();

  // беремо всіх активних користувачів з заданим digest_enabled (default true)
  const { data: users } = await supabase
    .from('users')
    .select('id, email, name, tg_chat_id, is_active');
  if (!users) return 0;

  let queued = 0;
  for (const u of users) {
    if (!u.is_active) continue;
    // перевірка prefs
    const { data: pref } = await supabase
      .from('team_task_user_prefs')
      .select('digest_enabled, digest_hour, last_digest_sent_on')
      .eq('user_id', u.id)
      .maybeSingle();
    const enabled = pref?.digest_enabled !== false;
    const digestHour = pref?.digest_hour ?? 9;
    if (!enabled || digestHour !== hour) continue;

    // задачі: open + (due_today OR overdue OR no_due AND priority p1/p2)
    const { data: tasks } = await supabase
      .from('team_tasks')
      .select('id, title, priority, status, due_date')
      .eq('assignee_id', u.id)
      .neq('status', 'done')
      .order('due_date', { ascending: true })
      .order('priority');
    const filtered = (tasks ?? []).filter(t =>
      (t.due_date && t.due_date <= today)
      || (!t.due_date && (t.priority === 'p1' || t.priority === 'p2'))
    ).slice(0, 12);

    // одна нотифікація на день
    const dedupe = `digest:${u.id}:${today}`;
    const { error } = await supabase.rpc('enqueue_team_task_notification', {
      p_recipient: u.id,
      p_task: null,
      p_kind: 'daily_digest',
      p_payload: { items: filtered },
      p_dedupe: dedupe,
    });
    if (!error) queued++;
  }
  return queued;
}

// ---------------------------------------------------------------------
// 4. Recurring tasks — створюємо новий instance
// ---------------------------------------------------------------------
function nextDueDate(recurrence: string, baseDate?: string): string | null {
  const base = baseDate ? new Date(baseDate) : new Date();
  base.setHours(0, 0, 0, 0);
  switch (recurrence) {
    case 'daily':   base.setDate(base.getDate() + 1); break;
    case 'weekly':  base.setDate(base.getDate() + 7); break;
    case 'monthly': base.setMonth(base.getMonth() + 1); break;
    case 'workdays': {
      base.setDate(base.getDate() + 1);
      while (base.getDay() === 0 || base.getDay() === 6) base.setDate(base.getDate() + 1);
      break;
    }
    default: return null;
  }
  return base.toISOString().slice(0, 10);
}

async function processRecurring(): Promise<number> {
  // знаходимо задачі recurrence != null, status = done, completed_at є,
  // і у яких немає активного «дитячого» tasks з parent_task_id = цього
  const { data: parents } = await supabase
    .from('team_tasks')
    .select('id, title, description, priority, assignee_id, recurrence, due_date, tags, watchers, estimated_h')
    .not('recurrence', 'is', null)
    .eq('status', 'done');

  let created = 0;
  for (const p of (parents ?? [])) {
    // чи вже є children з open status
    const { data: children } = await supabase
      .from('team_tasks')
      .select('id')
      .eq('parent_task_id', p.id)
      .neq('status', 'done')
      .limit(1);
    if (children && children.length) continue;

    const nextDue = nextDueDate(p.recurrence as string, p.due_date as string | undefined);
    if (!nextDue) continue;

    // не створюємо більш ніж за 7 днів вперед
    const diff = (new Date(nextDue).getTime() - Date.now()) / 86400000;
    if (diff > 7) continue;

    const { data: inserted, error } = await supabase
      .from('team_tasks')
      .insert({
        title: p.title,
        description: p.description,
        priority: p.priority,
        assignee_id: p.assignee_id,
        created_by: p.assignee_id, // власник recurring = creator нового
        due_date: nextDue,
        tags: p.tags,
        watchers: p.watchers,
        estimated_h: p.estimated_h,
        parent_task_id: p.id,
        // не успадковуємо recurrence — лише parent
      })
      .select('id')
      .single();
    if (!error && inserted) {
      created++;
      if (p.assignee_id) {
        await supabase.rpc('enqueue_team_task_notification', {
          p_recipient: p.assignee_id,
          p_task: inserted.id,
          p_kind: 'recurring_created',
          p_payload: { title: p.title, priority: p.priority, due_date: nextDue },
          p_dedupe: `recur:${inserted.id}`,
        });
      }
    }
  }
  return created;
}

// ---------------------------------------------------------------------
// HTTP entrypoint
// ---------------------------------------------------------------------
Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const r24 = url.searchParams.get('skip_r24') ? 0 : await enqueueReminders24h();
    const over = url.searchParams.get('skip_overdue') ? 0 : await enqueueOverdue();
    const digest = url.searchParams.get('skip_digest') ? 0 : await enqueueDailyDigest();
    const recurring = url.searchParams.get('skip_recurring') ? 0 : await processRecurring();

    // одразу триггер воркер
    let workerResult: unknown = null;
    if (r24 + over + digest + recurring > 0 && !url.searchParams.get('skip_worker')) {
      const r = await fetch(NOTIFY_URL + '?limit=50', {
        method: 'POST',
        headers: { 'authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
      });
      workerResult = await r.json().catch(() => ({ ok: false }));
    }

    return new Response(JSON.stringify({
      ok: true,
      queued: { reminders_24h: r24, overdue: over, daily_digest: digest, recurring_created: recurring },
      worker: workerResult,
      cet_hour: getCETHour(),
      ts: new Date().toISOString(),
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (e) {
    console.error('[cron] fatal:', e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }
});
