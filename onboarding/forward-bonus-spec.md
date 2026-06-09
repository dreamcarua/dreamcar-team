# 🎁 Forward Bonus — Повна специфікація (#245)

> **Мета:** користувач пересилає наш пост → отримує +1 безкоштовний токен → virality multiplier (k=1.5-2.5)

## Кратко

```
User A бачить пост у DreamCar каналі
  ↓
User A пересилає у власний чат / груповий чат
  ↓
Наш бот (присутній у тому чаті) бачить forward event
  ↓
Перевіряє anti-fraud:
  - Це наш пост? ✓ (через tg_post_analytics)
  - Audience size ≥50 учасників? ✓
  - Перший forward цього user-а для цього посту? ✓ (UNIQUE)
  - Cooldown 24г? ✓
  ↓
INSERT tg_forward_events (awarded_token=true)
DM forwarder: "Дякуємо! +1 токен — забери у @dreamcar_team_bot"
```

## Юридично

**Це НЕ лотерейна механіка.** Це маркетинговий бонус за engagement — як "приведи друга, отримай знижку". Не потребує ліцензії.

Аналогічні механіки:
- Uber: "Запроси друга → отримай $5 кредит"
- Dropbox: "Поділись посиланням → +500MB до квоти"
- WishList: "Forward у 3 чати → -10% знижка на purchases"

Лотерея = ризик грошима за випадковий результат. Forward bonus = винагорода за конкретну дію.

## DB Schema (✅ ВЖЕ СТВОРЕНА)

```sql
public.tg_forward_events:
  id uuid PK
  publication_id uuid FK → publications (nullable якщо пост видалили)
  source_channel_id text NOT NULL   -- наш канал звідки переслали
  source_message_id bigint NOT NULL
  forwarder_user_id bigint NOT NULL -- TG user_id того хто переслав
  forwarder_username text
  forwarded_to_chat_id bigint NOT NULL  -- куди переслали
  forwarded_to_chat_title text
  forwarded_to_chat_member_count integer  -- audience size (anti-fraud)
  awarded_token boolean DEFAULT false
  award_reason text                       -- 'ok' / 'small_audience' / 'self_forward' / 'cooldown' / 'duplicate' / 'bot_forwarder'
  awarded_at timestamptz
  created_at timestamptz

UNIQUE (forwarder_user_id, publication_id)  -- anti-fraud: один user → один токен на пост
```

RLS: ceo/coo/lead SELECT, service_role full.

## Як реалізувати (НЕ зроблено, ось як)

### A. TG Bot listening

Наш бот має бути присутній (як член або admin) у чаті де відбувається forward. Без цього бот НЕ бачить що user A переслав з нашого каналу.

**Стратегія:**
1. **Public discoverability:** бот у нашому каналі як admin → автоматично бачить forwards у Discussion Group комментарів
2. **Виклик "Запроси бота":** інструкція user-ам: "Додай @dreamcar_team_bot у свій груповий чат → отримуй токени за shares"
3. **Deep link:** post містить кнопку `https://t.me/dreamcar_team_bot?startgroup=true` → 1 клік + бот у групі

### B. Edge function `tg-forward-handler` (НЕ зроблений, але ось код)

```ts
// Receives TG webhook updates з message.forward_from_chat
// Перевіряє чи це наш канал → INSERT tg_forward_events
// → DM forwarder reward notification

const DC_CHANNEL_IDS = ['-1002496656144', '-1003933841573']; // production + test
const MIN_AUDIENCE = 50;
const COOLDOWN_HOURS = 24;
const TOKEN_REWARD = 1;

async function handleForward(sb, msg) {
  const fwdChat = msg.forward_from_chat;
  if (!fwdChat || !DC_CHANNEL_IDS.includes(String(fwdChat.id))) return { skipped: 'not_ours' };
  
  const forwarder = msg.from;
  if (!forwarder || forwarder.is_bot) return { skipped: 'bot_forwarder' };
  
  // Дед чат куди переслали
  const targetChat = msg.chat;
  const memberCount = await getChatMemberCount(targetChat.id);
  
  // Анти-self-forward: forwarder == chat owner
  if (await isChatOwner(targetChat.id, forwarder.id)) {
    return await logEvent(sb, msg, forwarder, targetChat, memberCount, false, 'self_forward');
  }
  
  // Min audience
  if (memberCount < MIN_AUDIENCE) {
    return await logEvent(sb, msg, forwarder, targetChat, memberCount, false, 'small_audience');
  }
  
  // Cooldown — max 1 reward на 24г
  const cooldownAgo = new Date(Date.now() - COOLDOWN_HOURS * 3600 * 1000).toISOString();
  const { count } = await sb.from('tg_forward_events')
    .select('id', { count: 'exact', head: true })
    .eq('forwarder_user_id', forwarder.id)
    .eq('awarded_token', true)
    .gte('awarded_at', cooldownAgo);
  if (count >= 1) {
    return await logEvent(sb, msg, forwarder, targetChat, memberCount, false, 'cooldown');
  }
  
  // Резолв publication_id з tg_post_analytics
  const { data: postRow } = await sb.from('tg_post_analytics')
    .select('publication_id')
    .eq('channel_id', String(fwdChat.id))
    .eq('message_id', msg.forward_from_message_id)
    .maybeSingle();
  const publicationId = postRow?.publication_id;
  
  // Insert + UNIQUE constraint фільтрує дублі автоматично
  const { error } = await sb.from('tg_forward_events').insert({
    publication_id: publicationId,
    source_channel_id: String(fwdChat.id),
    source_message_id: msg.forward_from_message_id,
    forwarder_user_id: forwarder.id,
    forwarder_username: forwarder.username,
    forwarded_to_chat_id: targetChat.id,
    forwarded_to_chat_title: targetChat.title,
    forwarded_to_chat_member_count: memberCount,
    awarded_token: true,
    award_reason: 'ok',
    awarded_at: new Date().toISOString()
  });
  
  if (error?.code === '23505') {
    // UNIQUE violation — user вже отримав за цей пост
    return { skipped: 'duplicate' };
  }
  
  // Reward: token credit + DM notification
  await creditToken(forwarder.id, TOKEN_REWARD);
  await sendDM(forwarder.id, 
    `🎁 Дякуємо за share!\n\nТобі нараховано +${TOKEN_REWARD} токен.\n` +
    `Натисни /balance у боті щоб побачити баланс.`
  );
  
  return { awarded: true, forwarder: forwarder.id };
}
```

### C. Token credit integration

Це треба інтегрувати з existing tokens system (PHP). Два варіанти:

**Варіант 1: REST API call**
```ts
async function creditToken(userId, amount) {
  await fetch('https://dreamcar.ua/api/v1/credit_token', {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY },
    body: JSON.stringify({ tg_user_id: userId, amount, reason: 'forward_bonus' })
  });
}
```

**Варіант 2: Direct DB write через MySQL connector**
(якщо є тільки DB access без REST)

### D. Anti-fraud matrix

| Сценарій | Detection | Дія |
|---|---|---|
| User A пересилає у свій приватний чат (нікому не видно) | `member_count < 50` | НЕ нагороджуємо. Reason: small_audience |
| User A пересилає у свій канал (admin/owner) | `isChatOwner == true` | НЕ нагороджуємо. Reason: self_forward |
| User A пересилає той самий пост двічі у різні чати | UNIQUE constraint | Insert fails. Дія skipped: duplicate |
| User A пересилає 50 постів одного дня | cooldown 24г між нагородами | Тільки перший нагороджується. Reason: cooldown (для решти) |
| User A — це бот | `from.is_bot == true` | НЕ нагороджуємо. Reason: bot_forwarder |
| User A пересилає пост якого вже немає | `publication_id = null` | Дозволяємо (бо може бути legit), але log без `publication_id` |
| User A створив 100 dummy чатів з ботом + member count = 51 | Soft detection: суміжний chat list через MTProto | Phase 5: тег "suspicious" + manual review |

### E. Dashboard analytics

Додати у `dashboard.dreamcar.ua` sidebar новий пункт **"📣 Forwards"**:

| Metric | Period | Approach |
|---|---|---|
| Total forwards last 7d | `count(*)` | `tg_forward_events WHERE created_at >= now()-7d` |
| Awarded tokens last 7d | `sum(awarded_token::int)` | `WHERE awarded_token=true` |
| Top forwarders (leaderboard) | by forwarder_user_id | GROUP BY + ORDER count DESC LIMIT 10 |
| Most-forwarded posts | by publication_id | GROUP BY publication_id + post title |
| Conversion rate | forwards / impressions | divide by views from MTProto worker |
| Fraud rejected | by award_reason | GROUP BY award_reason WHERE awarded=false |

## Phase 4 implementation plan

| # | Step | Час | Залежить |
|---|---|---|---|
| 1 | Created `tg_forward_events` table | ✅ DONE | — |
| 2 | Edge fn `tg-forward-handler` | ~2 год | TG webhook setup |
| 3 | Token credit API endpoint (PHP) | ~1 год | DreamCar tokens DB |
| 4 | Update tg-channel-engage щоб ловив forward events теж | ~30хв | — |
| 5 | Test з реальним forward у test channel | ~30хв | TG webhook live |
| 6 | Dashboard "Forwards" page | ~1 год | — |
| 7 | Beta rollout (3 дні monitoring + tweak min_audience) | 3 дні | — |
| 8 | Production launch + announce у каналі | 1 день | — |

**Загалом: ~7 годин разработки + 3-4 дні monitoring до повного rollout.**

## Очікувані результати

З benchmarks подібних механік:
- **Forward conversion rate:** 2-5% (user-ів які forwardять пост після прочитання)
- **K-factor:** 1.5-2.5 на warm content (member of dreamcar audience)
- **Token economy impact:** +1 токен × 100 forwards/тиждень = 100 tokens give-away/тиждень
- **Виручка multiplier:** +35-80% organic reach при тому ж ad spend

Якщо середній пост зараз = 1000 views → з Forward Bonus буде 2000-3500 views на 1-2 тиждень після launch.

## ROI Calculator

Припустимо:
- 100 forwards/тиждень × $0.50 cost per free token = **$50/тиждень cost**
- +60% organic reach = +600 views на пост × 30 постів/тиждень = +18 000 views
- Конверсія views → token purchase: 0.5% × avg $5 spend = +$450/тиждень revenue

**ROI: 9x** (+$450 revenue / -$50 cost)

Звичайно, цифри залежать від реальних метрик. Beta для відкалібрування.
