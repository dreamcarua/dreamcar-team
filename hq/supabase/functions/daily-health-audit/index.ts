// daily-health-audit — щоденний автоматичний audit
// pg_cron 7:00 CET → POST → email (Resend) + TG (notify-tg)
// Перевіряє: pubs, tasks, creatives, queues, users, errors → формує HTML report

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? 'DreamCar Audit <audit@dreamcar.ua>';
const RECIPIENT = Deno.env.get('AUDIT_RECIPIENT') ?? 'vg@dreamcar.ua';
const TG_BOT_TOKEN = Deno.env.get('TG_BOT_TOKEN') ?? '';
const TG_CHAT_ID = Deno.env.get('TG_CHAT_ID') ?? '';

const sb = createClient(SB_URL, SB_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

interface Issue { sev: 'red' | 'yellow' | 'green'; cat: string; msg: string; action?: string; }
interface Section { title: string; items: Array<{ k: string; v: string | number; trend?: string }>; }

async function gatherMetrics() {
  const sections: Section[] = [];
  const issues: Issue[] = [];

  // ===== Publications =====
  const { data: pubs } = await sb.from('publications').select('id,status,created_at,published_at,publish_at').is('deleted_at', null);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const last24 = new Date(Date.now() - 24*3600*1000);
  const last7d = new Date(Date.now() - 7*86400000);

  const pubsT = pubs || [];
  const created24h = pubsT.filter((p:{created_at:string}) => new Date(p.created_at) > last24).length;
  const published24h = pubsT.filter((p:{published_at?:string}) => p.published_at && new Date(p.published_at) > last24).length;
  const created7d = pubsT.filter((p:{created_at:string}) => new Date(p.created_at) > last7d).length;
  const upcoming = pubsT.filter((p:{status:string,publish_at?:string}) => p.status==='approved' && p.publish_at && new Date(p.publish_at) > new Date()).length;
  const reviewPending = pubsT.filter((p:{status:string}) => p.status === 'review').length;
  const inwork = pubsT.filter((p:{status:string}) => p.status === 'in_work').length;

  sections.push({
    title: '📝 ПУБЛІКАЦІЇ',
    items: [
      { k: 'Усього (active)', v: pubsT.length },
      { k: 'Створено за 24год', v: created24h, trend: created24h > 0 ? '+'+created24h : '0' },
      { k: 'Опубліковано за 24год', v: published24h },
      { k: 'За 7 днів', v: created7d },
      { k: 'У review', v: reviewPending },
      { k: 'In work', v: inwork },
      { k: 'Заплановано (approved)', v: upcoming },
    ],
  });

  if (reviewPending >= 3) issues.push({ sev: 'yellow', cat: 'Pubs', msg: `${reviewPending} публікацій чекають погодження > 1 день`, action: 'Перевірити чи всі approvers активні' });

  // ===== Tasks =====
  const { data: tasks } = await sb.from('team_tasks').select('id,status,priority,assignee_id,due_date,created_at,completed_at');
  const tsks = tasks || [];
  const taskOverdue = tsks.filter((t: {status:string,due_date?:string}) => t.status !== 'done' && t.due_date && new Date(t.due_date) < todayStart);
  const tasksDone24h = tsks.filter((t:{status:string,completed_at?:string}) => t.status === 'done' && t.completed_at && new Date(t.completed_at) > last24).length;
  const taskHipri = tsks.filter((t:{status:string,priority:string}) => (t.priority === 'p1' || t.priority === 'p2') && t.status !== 'done').length;

  sections.push({
    title: '✅ ЗАДАЧІ',
    items: [
      { k: 'Усього', v: tsks.length },
      { k: 'Активних', v: tsks.filter((t:{status:string})=>t.status !== 'done').length },
      { k: 'P1+P2 active', v: taskHipri },
      { k: 'Закрито за 24год', v: tasksDone24h },
      { k: 'Прострочених', v: taskOverdue.length },
    ],
  });

  if (taskOverdue.length > 0) {
    issues.push({ sev: taskOverdue.length >= 3 ? 'red' : 'yellow', cat: 'Tasks',
      msg: `${taskOverdue.length} прострочених задач`, action: 'Зайти у /tasks → фільтр ПРОТЕРМ → переглянути' });
  }
  if (taskHipri >= 5) issues.push({ sev: 'yellow', cat: 'Tasks', msg: `${taskHipri} активних P1+P2 — багато критики` });

  // ===== Creatives + Compression =====
  const { data: cre } = await sb.from('creatives').select('id,type,compressed_status,compress_attempts').is('deleted_at', null);
  const creT = cre || [];
  const cPending = creT.filter((c:{compressed_status:string})=>c.compressed_status === 'pending').length;
  const cProcessing = creT.filter((c:{compressed_status:string})=>c.compressed_status === 'processing').length;
  const cReady = creT.filter((c:{compressed_status:string})=>c.compressed_status === 'ready').length;
  const cFailed = creT.filter((c:{compressed_status:string})=>c.compressed_status === 'failed').length;
  const cStuck = creT.filter((c:{compress_attempts:number,compressed_status:string})=>c.compress_attempts >= 3 && c.compressed_status === 'pending').length;

  sections.push({
    title: '🖼 КРЕАТИВИ',
    items: [
      { k: 'Усього', v: creT.length },
      { k: 'Фото', v: creT.filter((c:{type:string})=>c.type === 'photo').length },
      { k: 'Відео', v: creT.filter((c:{type:string})=>c.type === 'video').length },
      { k: 'Compress pending', v: cPending },
      { k: 'Compress processing', v: cProcessing },
      { k: 'Compress ready', v: cReady },
      { k: 'Compress failed', v: cFailed },
    ],
  });

  if (cStuck > 0) issues.push({ sev: 'red', cat: 'Compress', msg: `${cStuck} креативів застрягли (3+ attempts)`, action: 'Перевірити GH Action compress-creative logs' });
  if (cPending > 50) issues.push({ sev: 'yellow', cat: 'Compress', msg: `${cPending} pending — велика черга` });
  if (cFailed > 0) issues.push({ sev: 'red', cat: 'Compress', msg: `${cFailed} failed permanent — потрібен manual reset` });

  // ===== Autopost queue =====
  const { data: ap } = await sb.from('tg_autopost_queue').select('id,status,platform,claimed_at');
  const apT = ap || [];
  const apPending = apT.filter((j:{status:string})=>j.status === 'pending').length;
  const apProcessing = apT.filter((j:{status:string})=>j.status === 'processing').length;
  const apFailed24h = apT.filter((j:{status:string,claimed_at?:string})=>j.status === 'failed' && j.claimed_at && new Date(j.claimed_at) > last24).length;
  const apDone24h = apT.filter((j:{status:string,claimed_at?:string})=>j.status === 'done' && j.claimed_at && new Date(j.claimed_at) > last24).length;

  sections.push({
    title: '🚀 АВТОПОСТИНГ',
    items: [
      { k: 'Pending', v: apPending },
      { k: 'Processing', v: apProcessing },
      { k: 'Опубліковано за 24h', v: apDone24h },
      { k: 'Помилки за 24h', v: apFailed24h },
    ],
  });

  if (apProcessing > 3) issues.push({ sev: 'yellow', cat: 'Autopost', msg: `${apProcessing} застрягли у processing` });
  if (apFailed24h > 0) issues.push({ sev: 'red', cat: 'Autopost', msg: `${apFailed24h} автопост-помилок за добу`, action: 'Перевірити GH Action logs tg-autopost.yml' });

  // ===== Users =====
  const { data: users } = await sb.from('users').select('id,name,email,role,auth_id,tg_chat_id,is_active');
  const usrT = (users||[]).filter((u: {is_active?:boolean})=>u.is_active !== false);
  const noAuth = usrT.filter((u:{auth_id?:string})=>!u.auth_id);
  const noTg = usrT.filter((u:{tg_chat_id?:string})=>!u.tg_chat_id);

  sections.push({
    title: '👥 КОМАНДА',
    items: [
      { k: 'Активних користувачів', v: usrT.length },
      { k: 'З auth_id', v: usrT.length - noAuth.length },
      { k: 'З TG bind', v: usrT.length - noTg.length },
    ],
  });

  if (noAuth.length > 0) issues.push({ sev: 'yellow', cat: 'Users',
    msg: `${noAuth.length} без auth_id: ${noAuth.map((u:{name:string})=>u.name).join(', ')}`,
    action: 'Попросити зайти у /hq через Google' });
  if (noTg.length > 0) issues.push({ sev: 'yellow', cat: 'Users',
    msg: `${noTg.length} без TG: ${noTg.map((u:{name:string})=>u.name).join(', ')}`,
    action: 'Дати лінк @dreamcar_team_bot /start' });

  // ===== Notifications =====
  const { data: nt } = await sb.from('team_task_notifications').select('id,state,sent_tg,sent_email,created_at');
  const ntT = nt || [];
  const nt24h = ntT.filter((n:{created_at:string})=>new Date(n.created_at) > last24);

  sections.push({
    title: '🔔 НОТИФІКАЦІЇ',
    items: [
      { k: 'Створено за 24h', v: nt24h.length },
      { k: 'Доставлено TG', v: nt24h.filter((n:{sent_tg?:boolean})=>n.sent_tg).length },
      { k: 'Доставлено Email', v: nt24h.filter((n:{sent_email?:boolean})=>n.sent_email).length },
      { k: 'У черзі', v: ntT.filter((n:{state:string})=>n.state === 'pending').length },
    ],
  });

  // ===== Cron jobs =====
  const { data: cronJobs } = await sb.from('cron.job_run_details' as 'team_tasks').select('status').gte('start_time', last24.toISOString());
  const cronT = cronJobs || [];
  const cronFailed = cronT.filter((c:{status:string})=>c.status === 'failed').length;

  if (cronFailed > 0) issues.push({ sev: 'red', cat: 'Cron', msg: `${cronFailed} pg_cron failures за 24h`, action: 'Supabase Dashboard → Database → Cron jobs' });

  // ===== Health Score =====
  let score = 100;
  for (const i of issues) {
    if (i.sev === 'red') score -= 10;
    else if (i.sev === 'yellow') score -= 3;
  }
  score = Math.max(0, score);

  return { sections, issues, score, generatedAt: new Date() };
}

function renderEmailHtml(data: { sections: Section[]; issues: Issue[]; score: number; generatedAt: Date }): string {
  const { sections, issues, score, generatedAt } = data;
  const ts = generatedAt.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'long', timeStyle: 'short' });
  const reds = issues.filter(i => i.sev === 'red');
  const yellows = issues.filter(i => i.sev === 'yellow');
  const scoreColor = score >= 90 ? '#10B981' : score >= 70 ? '#F59E0B' : '#DC2626';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>DreamCar Daily Audit</title></head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:'Manrope','Helvetica',sans-serif;color:#FFFFFF;">
<div style="max-width:680px;margin:0 auto;padding:32px 24px;">

  <div style="border-bottom:2px solid #E30613;padding-bottom:18px;margin-bottom:28px;">
    <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#E30613;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:6px;">/// DAILY AUDIT</div>
    <h1 style="font-family:'Oswald','Bebas Neue',sans-serif;font-size:34px;margin:0;letter-spacing:0.01em;color:#FFF;">DREAM<span style="color:#E30613;">CAR</span> HEALTH REPORT</h1>
    <div style="font-size:13px;color:#888;margin-top:8px;">${ts} · автоматичний звіт</div>
  </div>

  <div style="background:#141414;border:1px solid #2A2A2A;border-left:4px solid ${scoreColor};border-radius:8px;padding:24px 28px;margin-bottom:28px;display:flex;align-items:center;gap:20px;">
    <div style="font-family:'Oswald',sans-serif;font-size:72px;line-height:1;color:${scoreColor};">${score}</div>
    <div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#888;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:6px;">HEALTH SCORE</div>
      <div style="font-size:15px;color:#DDD;">
        ${score >= 90 ? '🟢 Все під контролем' : score >= 70 ? '🟡 Потребує уваги' : '🔴 Критичні проблеми'}
      </div>
    </div>
  </div>

  ${reds.length || yellows.length ? `
  <div style="margin-bottom:28px;">
    <h2 style="font-family:'Oswald',sans-serif;font-size:22px;margin:0 0 14px;color:#FFF;">⚠️ Що потребує дії</h2>
    ${reds.map(i => `
      <div style="background:rgba(220,38,38,0.08);border-left:3px solid #DC2626;padding:12px 16px;border-radius:0 6px 6px 0;margin-bottom:8px;">
        <div style="font-weight:700;color:#FF6A7A;font-size:14px;">🔴 [${i.cat}] ${i.msg}</div>
        ${i.action ? `<div style="font-size:12px;color:#BBB;margin-top:4px;">→ ${i.action}</div>` : ''}
      </div>`).join('')}
    ${yellows.map(i => `
      <div style="background:rgba(245,158,11,0.08);border-left:3px solid #F59E0B;padding:12px 16px;border-radius:0 6px 6px 0;margin-bottom:8px;">
        <div style="font-weight:700;color:#FBBF24;font-size:14px;">🟡 [${i.cat}] ${i.msg}</div>
        ${i.action ? `<div style="font-size:12px;color:#BBB;margin-top:4px;">→ ${i.action}</div>` : ''}
      </div>`).join('')}
  </div>` : `
  <div style="background:rgba(16,185,129,0.08);border-left:3px solid #10B981;padding:14px 18px;border-radius:0 6px 6px 0;margin-bottom:28px;">
    <div style="font-weight:700;color:#34D399;">🟢 Жодних проблем не виявлено — все працює без помилок</div>
  </div>`}

  ${sections.map(s => `
    <div style="background:#141414;border:1px solid #2A2A2A;border-radius:8px;padding:20px 24px;margin-bottom:14px;">
      <h3 style="font-family:'Oswald',sans-serif;font-size:18px;margin:0 0 14px;letter-spacing:0.02em;">${s.title}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        ${s.items.map(i => `
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #2A2A2A;color:#BBB;">${i.k}</td>
            <td style="padding:8px 0;border-bottom:1px solid #2A2A2A;text-align:right;font-family:'JetBrains Mono',monospace;font-size:13px;color:#FFF;font-weight:700;">
              ${i.v}${i.trend ? ` <span style="color:#10B981;font-size:11px;margin-left:6px;">(${i.trend})</span>` : ''}
            </td>
          </tr>`).join('')}
      </table>
    </div>`).join('')}

  <div style="margin-top:32px;padding-top:18px;border-top:1px solid #2A2A2A;font-size:11px;color:#666;font-family:'JetBrains Mono',monospace;line-height:1.6;">
    <div>Згенеровано: <a href="https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/daily-health-audit" style="color:#888;">daily-health-audit</a></div>
    <div>Час: ${ts} (CET) · pg_cron 0 7 * * *</div>
    <div>HQ: <a href="https://team.dreamcar.ua/hq/" style="color:#E30613;">team.dreamcar.ua/hq</a> · Tasks: <a href="https://team.dreamcar.ua/tasks/" style="color:#E30613;">team.dreamcar.ua/tasks</a></div>
    <div style="margin-top:8px;color:#444;">DreamCar Team Hub · автоматичний health audit</div>
  </div>
</div>
</body></html>`;
}

function renderTgSummary(data: { sections: Section[]; issues: Issue[]; score: number }): string {
  const { sections, issues, score } = data;
  const reds = issues.filter(i => i.sev === 'red');
  const yellows = issues.filter(i => i.sev === 'yellow');
  const emoji = score >= 90 ? '🟢' : score >= 70 ? '🟡' : '🔴';
  const lines = [];
  lines.push(`<b>${emoji} DAILY AUDIT · ${score}/100</b>`);
  lines.push('');
  if (reds.length) lines.push('<b>🔴 КРИТИЧНІ:</b>');
  for (const i of reds) lines.push(`• [${i.cat}] ${i.msg}`);
  if (yellows.length) lines.push('<b>🟡 ПОПЕРЕДЖЕННЯ:</b>');
  for (const i of yellows) lines.push(`• [${i.cat}] ${i.msg}`);
  if (!reds.length && !yellows.length) lines.push('<i>Жодних проблем не виявлено</i>');
  lines.push('');
  lines.push('<b>📊 КЛЮЧОВЕ:</b>');
  for (const s of sections.slice(0, 3)) {
    lines.push(`<b>${s.title}</b>`);
    for (const it of s.items.slice(0, 4)) lines.push(`  ${it.k}: <b>${it.v}</b>${it.trend ? ' '+it.trend : ''}`);
  }
  lines.push('');
  lines.push('📧 Повний звіт: дивись email.');
  return lines.join('\n');
}

async function sendEmail(html: string, subject: string): Promise<{ ok: boolean; err?: string }> {
  if (!RESEND_API_KEY) return { ok: false, err: 'no_RESEND_API_KEY' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'authorization': `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: RESEND_FROM, to: RECIPIENT, subject, html }),
    });
    if (!r.ok) return { ok: false, err: `resend_${r.status}: ${(await r.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) { return { ok: false, err: (e as Error).message }; }
}

async function sendTg(text: string): Promise<{ ok: boolean }> {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return { ok: false };
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    return { ok: r.ok };
  } catch { return { ok: false }; }
}

Deno.serve(async (req) => {
  try {
    const data = await gatherMetrics();
    const html = renderEmailHtml(data);
    const tgText = renderTgSummary(data);
    const today = new Date().toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit' });
    const emoji = data.score >= 90 ? '🟢' : data.score >= 70 ? '🟡' : '🔴';
    const subject = `${emoji} DreamCar Daily Audit · ${data.score}/100 · ${today}`;
    const [emailRes, tgRes] = await Promise.all([sendEmail(html, subject), sendTg(tgText)]);
    return new Response(JSON.stringify({
      ok: true, score: data.score, issues: data.issues.length,
      email: emailRes, tg: tgRes,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500 });
  }
});
