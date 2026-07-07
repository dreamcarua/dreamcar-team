# Meta Ads 2026 — зовнішні best practices для DreamCar

**Дата:** 07.07.2026
**Метод:** WebSearch (20+ запитів) + повний фетч першоджерел: Meta Engineering Blog, Meta Marketing Blog (через Social Media Today), Jon Loomer, TheOptimizer, Admixer/AIN.ua (UA-ринок), юридичні гайди по промо-механіках.
**Фільтр:** лише те, що застосовно до кейсу DreamCar — low-AOV токени (49–249 грн вхід, апсейли до 1499), цикли 2–4 тижні з фіналом-стрімом + 2-денні бліци, UA, чоловіки 25–44, ~500k грн/міс spend, ціль pixel ROAS 10–15.

**Маркування довіри:**
- `[Meta]` — офіційне джерело Meta
- `[практики]` — агентські/вендорські бенчмарки (порядок величини вірний, цифри ±)
- `[гіпотеза]` — реверс-інжиніринг практиків, офіційно не підтверджено

---

## 1. Advantage+ Sales 2026: ера Andromeda

**Контекст.** Andromeda — retrieval-движок Meta (глобальний розкат жовтень 2025): на етапі відбору система сканує десятки мільйонів оголошень і відбирає кілька тисяч кандидатів, далі ранжує GEM. Офіційна позиція Meta: «advertisers who provide truly differentiated assets can unlock greater reach, personalization, and performance» — тобто таргетинг тепер де-факто визначається креативом, а не налаштуваннями аудиторії. `[Meta]` ([Meta Engineering](https://engineering.fb.com/2024/12/02/production-engineering/meta-andromeda-advantage-automation-next-gen-personalized-ads-retrieval-engine/), [Meta via Social Media Today, 17.12.2025](https://www.socialmediatoday.com/news/meta-shares-tips-on-reels-hooks-creative-diversification-in-ads-and-threa/808182/))

### Тактики

**1.1. ASC — ядро acquisition, manual — final-sprint і carve-outs.**
Консенсус 2026: гібрид. 40–80% бюджету в ASC (always-on, broad, повне тестування креативів), manual-кампанії лишаються для: (а) high-value ретаргетингу з urgency-креативом, (б) вузьких вікон (фінали/бліци), (в) кейсів де потрібні жорсткі exclusions. ASC у бенчмарках дає ~15–32% нижчий CPA vs manual на бюджетах $300–1000/день `[практики]`. Для UA-ринку Admixer підтверджує: ASC у середньому +32% ROAS `[практики]`.
🎯 **DreamCar:** поточна структура (ASC + ручні prospecting/retargeting + ON_POST) вже відповідає best practice. Що додати: mid-cycle тримати ASC як основний акумулятор spend; на фінал НЕ ламати ASC, а запускати паралельну manual sales кампанію фінального вікна (див. розділ 3).
Джерела: [Elevate Digital](https://elevate-digital-solutions.com/meta-advantage-plus-vs-manual-campaigns/), [MHI Growth Engine](https://mhigrowthengine.com/blog/advantage-plus-vs-manual-campaigns-meta-2026/), [Skale Strategy](https://www.skalestrategy.com/blog/meta-advantage-plus-shopping-campaigns-2026), [AIN.ua/Admixer](https://ain.ua/2026/03/11/trendy-reklamy-meta-ukraina-2026/)

**1.2. Existing Customer Budget Cap — ВИДАЛЕНИЙ. Заміна — ручні exclusions.**
Meta прибрала цю опцію з ASC (Help Center: «Existing customer budget cap … is no longer available. You can still do the same thing manually»). Офіційна заміна: (1) manual sales кампанія з ad set-ом, що виключає custom audiences існуючих клієнтів (= еквівалент cap 0%), або (2) два ad set-и — один на клієнтів, один broad з виключенням клієнтів — під Advantage Campaign Budget + ad set spending limit як «кап». `[Meta через Jon Loomer]`
🎯 **DreamCar:** якщо треба контролювати частку spend на повторних покупців (учасники повертаються щоциклу — це фіча, не баг), не шукати cap у ASC. Для acquisition-кампанії «на НОВИХ» (захищена) — тримати exclusion списку покупців актуальним (див. 6.2). Для ASC — задати audience segments (existing customers) хоча б для звітності: скільки ASC витрачає на нових vs повторних.
Джерело: [Jon Loomer — No More Existing Customer Budget Cap](https://www.jonloomer.com/qvt/no-more-existing-customer-budget-cap/)

**1.3. Audience suggestions замість чистих LAL.**
У 2026 класичні LAL «лише трохи кращі за broad» `[практики]`, але працюють як **suggestions** усередині Advantage+ audience: даєш системі seed (список покупців high-LTV / LAL), вона стартує з нього і розширюється сама. Це найкращий компроміс контроль/масштаб.
🎯 **DreamCar:** у всіх Advantage+ audience ад-сетах додати suggestion = customer list «покупці 180д» + окремо value-based seed «топ-20% за LTV» (у вас є LTV у Supabase). Не звужувати жорстко.
Джерела: [Stackmatix — Lookalikes 2026](https://www.stackmatix.com/blog/facebook-lookalike-audiences-strategy-2026), [Dotidot](https://www.dotidot.io/post/lookalike-audiences-meta-what-works-now-in-2026), [alexneiman — Advantage+ Audience 2026](https://alexneiman.com/meta-advantage-plus-audience-targeting-2026/)

**1.4. Сигнал важливіший за структуру: EMQ і повна воронка подій.**
Під Andromeda якість конверсійного сигналу — третій важіль після креативу і простоти структури. CAPI + дедуплікація, Event Match Quality ≥6/10, повна воронка подій (не тільки Purchase). `[практики, підтверджено логікою Meta]`
🎯 **DreamCar:** перевірити EMQ у Events Manager; слати value з кожним Purchase (потрібно для 3.2 і 6.1); додати проміжні події (реєстрація, вибір тарифу, initiate checkout) якщо ще не всі йдуть через CAPI.
Джерела: [jetfuel.agency](https://jetfuel.agency/metas-2026-algorithm-update-what-andromeda-changed-and-how-to-adapt-your-ads/), [TheOptimizer — bidding 2026](https://theoptimizer.io/blog/meta-ads-bidding-in-2026-cost-cap-vs-bid-cap-and-when-to-use-each)

---

## 2. Креатив-фреймворки 2026

**Контекст.** Офіційна рекомендація Meta (грудень 2025): «embracing creative diversification as a foundational best practice… building a broad portfolio of assets that take more creative liberty across text, image, and video, reflecting multiple customer personas» `[Meta]`. Термін життя креативу під Andromeda стиснувся: практики репортять ефективні 2–4 тижні замість 6–8, перші ознаки втоми з 3–7 дня на високих частотах `[практики]` — ваші 7–10 днів у нормі для low-AOV impulse-продукту.

### Тактики

**2.1. Кількість: 10–20 активних креативів у кампанії, +3–5 нових на тиждень.**
Консенсус діапазонів 2026: 10–20 активних у ASC; 2–4 нові КОНЦЕПЦІЇ на тиждень (не варіації однієї); на spend $10k+/міс — свіже крео кожні 1–2 тижні мінімум. Ключова метрика — різноманітність: мін. 10 креативних одиниць across ≥3 різні персони/бенефіти; надто схожі оголошення (>60% similarity) практики вважають тригером «retrieval suppression» — Andromeda бачить їх як клатер `[гіпотеза]`.
🎯 **DreamCar:** будувати тижневий конвеєр за матрицею **персона × кут × формат**: персони (мрійник про авто / прагматик «виграв — продав» / фанат стрімів / скептик, якому потрібні докази 16 переданих авто) × кути (історія переможця / протикання «це скам?» доказами / продукт-ШІ / зворотний відлік фіналу) × формати (9:16 відео, статика, карусель переможців). 12–16 комбінацій = місячний запас. utm_term=claude для ботових — вже є.
Джерела: [Meta via SMT](https://www.socialmediatoday.com/news/meta-shares-tips-on-reels-hooks-creative-diversification-in-ads-and-threa/808182/), [Skale Strategy](https://www.skalestrategy.com/blog/meta-advantage-plus-shopping-campaigns-2026), [Good Morning](https://goodmorningco.com/blog/how-often-refresh-meta-ads-creative), [AdsUploader — Entity IDs](https://adsuploader.com/blog/meta-andromeda), [MTM Agency](https://themtmagency.com/blog/meta-andromeda-october-2025-update-why-creative-diversity-now-defines-ad-performance)

**2.2. Flexible ads / Dynamic Creative: не будувати на них процеси — усе поглинає Advantage+ creative.**
Хронологія: Dynamic Creative (ad set level) → замінений Flexible ads (ad level) → з березня 2026 Flexible прибирають з Ads Manager, логіка (авто-вибір формату, мультикреативна видача) поглинається Advantage+ creative; у налаштуваннях з'явились «Format display options», що замінюють Flexible/Collection: «Single image or video» тепер приймає до 10 медіа. `[практики + зміни UI]`
🎯 **DreamCar:** не інвестувати час у flexible-структури. Стандарт: звичайні ads з увімкненими Advantage+ creative enhancements (вибірково — перевіряти, що enhancement не спотворює бренд-стиль) + до 10 медіа у форматних опціях.
Джерела: [Campaign Builder](https://www.campaignbuilder.io/blogs/meta-flexible-ads-removed-2026), [Metricool](https://metricool.com/flexible-ads-meta/), [Swipe Insight — Meta Ads updates](https://web.swipeinsight.app/topics/meta-ads)

**2.3. UGC-first для холодного трафіку, polished — на підтримку. UGC вигорає швидше.**
UGC-style стабільно б'є студійне у транзакційних продуктах: +35–38% CTR, −25–50% CPA `[практики]`; АЛЕ вигорає швидше (4–8 тижнів на масштабі vs 6–14 у branded). Оптимум на spend >£5k/міс: UGC як primary cold + branded статика як secondary.
🎯 **DreamCar:** у вас найсильніший UGC-актив у ніші — **реальні передачі авто і фінали-стріми**. Конвеєр: (1) нарізки live-фіналу «момент оголошення» 9:16, (2) selfie-відео переможців 20–30с, (3) «день з життя» з переданим авто, (4) реакції з чату стріму (скріни як статика). Це одночасно і соціальний доказ проти «скам»-скепсису.
Джерела: [Stackmatix — UGC](https://www.stackmatix.com/blog/ugc-ads-strategy-for-brands), [770 Agency](https://770agency.com/blog/meta-ads-creative-strategy-2026), [saadkhanads — UGC vs Branded](https://saadkhanads.com/blogs/ugc-ads-vs-branded-creatives-meta-ads/)

**2.4. Hook-first 9:16: 47% цінності відео — у перших 3 секундах.**
Дані Meta: 47% value відео доставляється у перші 3с, 74% — до 10с; молодша аудиторія споживає контент у 3x швидше. Три офіційні типи хуків: value promise / statement of intent / question-invitation. Аудіо — недооцінений важіль: музика або voiceover у Reels дає до +13% інкрементальних конверсій `[Meta]`. Бенчмарк hook rate (3-sec views / impressions): ціль >30%, <25% = хук провалений. 85% фіду дивляться без звуку → перші 3с мають працювати візуально, але звук додавати завжди.
🎯 **DreamCar:** A/B тестувати хуки трьох типів на одному тілі відео: value promise («Це авто передали учаснику минулого тижня»), intent («Зараз покажу, як працює DreamCar»), question («Що б ти зробив із цим X5?»). Міряти hook rate у розрізі креативів (додати у щоденний аудит). Всі Reels — з музикою/voiceover.
Джерела: [Meta via SMT — Science of the Hook](https://www.socialmediatoday.com/news/meta-shares-tips-on-reels-hooks-creative-diversification-in-ads-and-threa/808182/), [Coinis — First 3 Seconds](https://coinis.com/how-to/first-3-seconds-facebook-video-ad), [Benly — Creative Best Practices](https://benly.ai/learn/meta-ads/creative-best-practices)

**2.5. ⚠️ AI-disclosure: з березня 2026 недекларований AI-контент — часта причина реджектів.**
Meta вимагає позначати AI-generated/AI-modified контент (чекбокс в Ads Manager). `[практики + Jon Loomer]`
🎯 **DreamCar:** якщо генеруєте креативи через AI (фони, image-to-video) — ставити disclosure, інакше ловите зайві реджекти на й без того чутливій механіці.
Джерела: [Anchour — Meta Ads 2026 Playbook](https://www.anchour.com/articles/meta-ads-2026-playbook/), [Jon Loomer — AI Disclosure Checkbox](https://www.jonloomer.com/ai-disclosure-checkbox-chatgpt-attribution/)

---

## 3. Bid-стратегії для флеш-запусків

**Контекст.** П'ять стратегій 2026: Highest Volume (ex-Lowest Cost), Highest Value, Cost Cap, Bid Cap, Min ROAS (ROAS Goal). Правило переходу: «switch based on performance signals, not a calendar»; мінімум 50 конверсій і 7–14 днів перед оцінкою. Важливо: **у ASC bid cap недоступний** — тільки cost-per-result goal (аналог cost cap).

### Тактики

**3.1. Не тікати з Lowest Cost передчасно.**
«Lowest Cost — правильна стратегія для 80% кампаній із бюджетом до €50k/міс. Cost Cap допомагає лише коли є жорсткий CPA-поріг І ≥€5k тижневого spend на ad set — інакше він душить видачу» `[практики]`. DreamCar ~500k грн/міс ≈ €10–11k/міс на весь акаунт → окремі ад-сети не дотягують до порогу.
🎯 **DreamCar:** ядро лишається на Lowest Cost / Highest Volume. Cost cap тестувати точково: лише на ремаркетингу фінального вікна, де CPA стабільний, і ставити кап на рівні trailing 14-денного CPA (не цільового!), знижуючи на 5–10%/тиждень.
Джерела: [AdLibrary — Bid Strategy Guide](https://adlibrary.com/posts/meta-bid-strategy-guide), [TheOptimizer](https://theoptimizer.io/blog/meta-ads-bidding-in-2026-cost-cap-vs-bid-cap-and-when-to-use-each), [Benly — Bidding](https://benly.ai/learn/meta-ads/bidding-strategies-guide)

**3.2. Min ROAS — кандидат саме для фінальних вікон, але з консервативним таргетом.**
ROAS Goal — «профітний фільтр»: Meta входить лише в аукціони з прогнозованим ROAS ≥ порога. Вимоги: чистий value у кожному Purchase (CAPI), достатній обсяг покупок. Рекомендація: старт з таргета +10–20% від поточного ROAS (не 10x при історичних 4x — інакше видача зупиниться); перед цим 4–6 тижнів на Highest Value для калібрування.
🎯 **DreamCar:** ваші фінальні вікна вже дають pixel 5–10 — це саме кейс «purchase values vary» (вхід 49–249 + апсейли до 1499). Тест: у фінальному вікні один value-optimized ад-сет з Min ROAS ≈ поточний ROAS вікна × 1.1. Якщо душить видачу — миттєво відкат на Highest Value. ⚠️ Не чіпати захищену кампанію «на НОВИХ».
Джерела: [Benly](https://benly.ai/learn/meta-ads/bidding-strategies-guide), [AdZeta — Value-Based Bidding](https://www.adzeta.io/blog/how-value-based-bidding-works-meta-setup-guide-2026), [Stackmatix — Bidding Strategy](https://www.stackmatix.com/blog/meta-ads-bidding-strategy)

**3.3. Ескалація бюджетів без зламу learning: 20% кроки / 48–72h + прогрів до вікна.**
Консенсус: +20% на крок, мінімум 48h між кроками (72h краще — повне вікно атрибуції); стрибок більший — ресет learning phase, система «розширюється» у гірші пули трафіку. Флеш-виняток: Accelerated delivery існує для time-sensitive, але +20–40% до CPC — майже завжди невигідно. Головний прийом BFCM-playbook-ів, що мапиться на ваші фінали: **не запускати нове холодним у вікно** — кампанії фінального вікна створювати і запускати заздалегідь на малому бюджеті (навчились до піку), у вікно лише масштабувати переможців.
🎯 **DreamCar (playbook фіналу):**
1. Д-7…Д-5: запустити final-sprint кампанію (lifetime budget, дата закінчення = фінал) на 15–20% цільового бюджету — виходить з learning ДО вікна.
2. Д-3: перший крок +20% на переможцях mid-cycle (після budget-edit — ЗАВЖДИ верифікація статусу, бо budget update може форсити PAUSE — ваш власний HARD RULE це підтверджує).
3. Д-2/Д-1: наступні кроки +20% з інтервалом 48h; нові гроші — тільки у вже навчені ад-сети.
4. Бліци 2 дні: окрема заздалегідь навчена кампанія, яку «будять» підняттям бюджету, а не створюють з нуля щоразу — коротке вікно не встигає пройти learning з нуля.
Джерела: [Roaspy — Scaling Timeline 2026](https://www.roaspy.com/blog/the-facebook-ads-scaling-timeline-2026-scale-budgets-without-crashing-roas), [AdLibrary — Learning Phase](https://adlibrary.com/posts/facebook-ads-learning-phase-too-long), [Madgicx — Budget Control](https://madgicx.com/blog/how-to-control-facebook-ad-budget), [Triple Whale — BFCM playbook](https://www.triplewhale.com/blog/facebook-ads-bfcm)

**3.4. У вікно — креативний запас ×3–4.**
BFCM-практика, що прямо переноситься на фінали: у високо-конкурентні вікна креатив вигорає швидше через частоту → на вікно готувати у 3–4 рази більше креативів, ніж у звичайний тиждень, + RFM-сегменти (нові / повторні / «сплячі» / VIP-апсейл) з окремими меседжами.
🎯 **DreamCar:** на фінальні 72h — окремий пак 8–12 креативів «тільки для вікна» (відлік, останній шанс приєднатись до учасників, live-анонс) + сегментовані меседжі: новим — вхід 49–199, повторним — апсейл-пакети.
Джерело: [Triple Whale — BFCM](https://www.triplewhale.com/blog/facebook-ads-bfcm)

---

## 4. Ad scheduling / dayparting 2026

**Контекст.** Нативний розклад показів існує ТІЛЬКИ з lifetime budget (ad set level). Для daily budget — лише automated rules (пауза/увімкнення), але цикли pause/resume дають середній ризик збиття delivery-моментуму. Головне правило 2026: розклад будується на **конверсійному** heatmap (Breakdown → By Time → Hour of Day, 30–60 днів), не на кліках; дешевий CPM о 4:00 без конверсій — сміття.

### Тактики

**4.1. Нічна пауза для always-on — НЕ рекомендована; для вікон — так, через lifetime budget.**
Нові кампанії мають крутитись 20+ год/добу перші 2 тижні (learning). Пауза вночі через automated rules на always-on ядрі = щоденний удар по learning. Натомість final-sprint кампанії з lifetime budget (3.3) — легально отримують нативний розклад.
🎯 **DreamCar:** ядро (ASC + захищена acquisition) — 24/7 без розкладу. Final-sprint і бліц-кампанії — lifetime budget + розклад, сконцентрований у вечірні пікові години і день фіналу (стрім о 20:00 → пік 17:00–23:00 Києва, перевірити на власному heatmap).
Джерела: [Wevion — Scheduling Best Practices](https://wevion.ai/en/blog/meta-ads-scheduling-best-practices/), [Meta Help — Schedule Ad Set](https://www.facebook.com/business/help/1381935425400769)

**4.2. Якщо все ж різати години — «розумні» умовні правила, не сліпий таймер.**
Правило «пауза о 21:00 ЯКЩО CPA за останні 4h > 1.5× target І spend > 2× target» зберігає видачу у несподівано сильні вечори. Очікуваний ефект правильного dayparting: −10–25% ефективного CPA без падіння обсягу конверсій; якщо конверсії впали — перерізали.
🎯 **DreamCar:** якщо heatmap покаже мертві 01:00–06:00 (<5% конверсій) — спершу тест умовним правилом на 1–2 кампаніях 30 днів проти always-on контролю, і тільки з понижувальним порогом, не жорсткою паузою.
Джерело: [Wevion](https://wevion.ai/en/blog/meta-ads-scheduling-best-practices/)

**4.3. ⚠️ CBO-пастка.**
Пауза одного ад-сета вночі у CBO-кампанії просто переливає бюджет в інші ад-сети (які вночі теж слабкі). Розклад — або на рівні кампанії, або ABO для кампаній, де dayparting — ядро стратегії.
Джерело: [Wevion](https://wevion.ai/en/blog/meta-ads-scheduling-best-practices/)

---

## 5. Модерація sweepstakes-adjacent механік (тільки білі практики)

**Контекст.** У Meta НЕМАЄ окремої політики «giveaway ads» — промо-оголошення ревʼюяться під загальними правилами (deceptive practices, transparency, unacceptable business practices). Більшість реджектів = нечіткі дисклоужери, недоступні правила, engagement-bait механіки. Паралельно жорсткішає сусідня категорія: з липня 2025 дозволи на Online Gambling & Gaming видаються через Permissions & Verifications у Business Suite (прив'язка до BM/ad account); липень 2025 — якщо віртуальна валюта обмінюється на реальні призи, це трактується як real-money gambling з вимогою ліцензії; 23.02.2026 — бан social casino ads у 19 ринках (Індія, Індонезія, Філіппіни, Таїланд, В'єтнам та ін. — **Україна/ЄС у списку не фігурують**). Головний ризик для DreamCar — не бан, а **рекласифікація акаунта у gambling-категорію**, що вимагатиме authorization.

### Тактики

**5.1. Пост-клік важить більше за ад-текст: LP з повним пакетом прозорості.**
Вимоги ревʼю до paid-промо: доступні ДО входу повні правила (eligibility, механіка участі, опис і вартість подарунків, як визначаються отримувачі, вирішення спорів); ключові дисклоужери видимі, а не заховані у футері; ад-копі ↔ LP ↔ правила без розбіжностей («ambiguous offer language» — часта причина реджекту).
🎯 **DreamCar:** окремий розділ/LP «Умови» з: (1) продукт = токени ШІ-сервісу з самостійною цінністю (юзкейси сервісу — на видному місці), (2) авто/iPhone = подарунки учасникам спільноти, механіка визначення у прямому ефірі описана нейтрально, (3) 16 переданих авто як публічний реєстр з датами/фото, (4) вік 18+, гео UA. Лінк на правила з кожного ad. Уникати в ad-копі слів-тригерів: win/lottery/raffle/ticket/odds/jackpot/prize draw і їх укр./рос. еквівалентів (у вас це вже HARD RULE — зовнішні джерела підтверджують, що ревʼю тригериться і на англомовні патерни).
Джерела: [The Social Media Law Firm — Giveaway Rules for Paid Ads](https://thesocialmedialawfirm.com/blog/social-media-compliance/social-media-giveaway-rules-for-paid-ads-on-facebook-instagram-a-platform-specific-compliance-guide/), [AuditSocials — 2026 Guide](https://www.auditsocials.com/blog/social-media-giveaway-sweepstakes-compliance-2026-platform-promotion-rules-illegal-lottery-test-official-rules-registration)

**5.2. Дисклеймер «Meta не причетна» + відмова від engagement-bait.**
Стандартні вимоги Promotion Guidelines: явна заява, що промо «in no way sponsored, endorsed or administered by, or associated with» Meta; release Meta від відповідальності; НЕ вимагати like/share/tag як умову участі (engagement bait → реджект + удар по account health).
🎯 **DreamCar:** додати Meta-дисклеймер у правила на LP; в ON_POST engagement-кампаніях перевірити тексти постів — жодних «тегни друга щоб взяти участь». Коментар-активності — тільки як розвага, не як механіка входу.
Джерела: [Meta — Promotion Guidelines](https://www.facebook.com/business/help/1494941357361432), [Gleam — Facebook Promotion Guidelines](https://gleam.io/blog/facebook-promotion-guidelines/)

**5.3. Тримати дистанцію від gambling-класифікації: продукт-перший фрейминг.**
Межа з політики Meta: проблеми починаються, коли «users can win something with monetary value» за гроші і це виглядає як основна суть оффера. Білий патерн з gaming/казуальних промо: 70%+ креативу — про продукт/спільноту/емоцію події, подарунок — контекст, не оффер; жодних «купи X — отримай шанс на Y», жодної згадки ймовірностей.
🎯 **DreamCar:** (1) періодичний селф-аудит креативів на «gambling-патерни» (формалізувати чекліст у щоденному аудиті); (2) НЕ подавати заявку на gambling authorization і не давати приводів для рекласифікації; (3) якщо реджект — правити формулювання і апелювати, НЕ ресабмітити ідентичне (повторні ресабміти б'ють по account health score); (4) моніторити Account Status у Business Suite щотижня.
Джерела: [Meta Transparency — Online Gambling and Games](https://transparency.meta.com/policies/ad-standards/restricted-goods-services/gambling-games/), [SCCG — Meta restrictions impact on sweepstakes](https://sccgmanagement.com/sccg-articles/2025/7/10/how-metas-new-gambling-ad-restrictions-impact-sweepstakes/), [AdAmigo — Gambling Ad Rules](https://www.adamigo.ai/blog/meta-gambling-ad-rules-what-changed), [Sweepsy — Feb 2026 policy](https://www.sweepsy.com/news/new-meta-ad-policy-sweepstakes-casino-changes/)

**5.4. Диверсифікація постклік-шляхів для модераційної стійкості.**
Практика similar-механік: кілька LP-варіантів (продуктова / освітня «як працює» / соціально-доказова «переможці») — якщо один URL ловить фільтр, кампанії не зупиняються повністю. Плюс окремі кампанії не шерять domain-репутаційний ризик з тестовими.
🎯 **DreamCar:** мати 2–3 живі LP-варіанти під різні кути креативів; нові «сміливі» креативи тестувати на окремій кампанії, не всередині кампаній-переможців.
Джерела: [Trapeze Media — Why Meta rejects ads](https://trapezemedia.co.uk/blog/meta-facebook-ad-rejection-fixes), [Brandwatch — Fix and Appeal](https://www.brandwatch.com/blog/facebook-ad-not-approved/)

---

## 6. Ремаркетинг / CRM

### Тактики

**6.1. Value-based seed: value rules працюють лише на Customer List і Website CA.**
Станом на квітень 2026 value rules (бід-мультиплікатори за сегментами) фаяряться тільки на customer list та website custom audiences — НЕ на LAL і НЕ на engagement audiences `[практики]`. Value-based LAL (seed з high-LTV клієнтів) досі покращують prospecting там, де цінність клієнта варіюється.
🎯 **DreamCar:** (1) вивантажити з Supabase сегмент «топ-20% LTV» (апсейли до 1499 + повторні цикли) → customer list CA → seed для value-based LAL і suggestion у Advantage+; (2) протестувати value rules: +20–40% бід на сегмент чоловіки 35–54 (ваш діамант 4.91 ROAS з meta_patterns) поверх cost cap ремаркетингу. Комбінація «Cost Cap + Value Rules» — найкраща за даними TheOptimizer.
Джерела: [alexneiman — Meta Value Rules](https://alexneiman.com/meta-value-rules-for-audiences/), [Meta for Developers — value-based lookalikes](https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/guides/value-based-lookalike-audiences), [TheOptimizer](https://theoptimizer.io/blog/meta-ads-bidding-in-2026-cost-cap-vs-bid-cap-and-when-to-use-each)

**6.2. Refresh customer lists: для вашої velocity — щотижня, покупці — щодня/48h.**
Стандарти 2026: high-velocity бізнеси (підписки, часті покупки — це ви, цикл 2–4 тижні) — refresh кожні 7 днів або continuous sync; «recent buyers» і exclusion-списки — синк щодня або кожні 48h (інакше показуєте acquisition-рекламу тим, хто вже купив = спалений бюджет); ціль match rate 80%+.
🎯 **DreamCar:** у вас уже є ETL-інфраструктура (GH Actions + Supabase) — додати workflow, що щоночі пушить через Marketing API: (1) purchasers_all (exclusion для «на НОВИХ»), (2) purchasers_current_cycle, (3) top_LTV_20. Це дешевий фікс із прямим ефектом на захищену кампанію.
Джерела: [AdLibrary — Custom Audience 2026](https://adlibrary.com/posts/custom-audience), [SolidHQ — First-Party Playbook](https://www.solidhq.com/paid-social/get-more-exposure-on-facebook-with-custom-audiences/), [LeadEnforce — When to Refresh](https://leadenforce.com/blog/when-to-refresh-custom-audiences-in-facebook-ads-for-better-accuracy)

**6.3. Engagement-драбина: найбільш privacy-стійкий актив 2026.**
Engagement audiences (IG engagers, video viewers 25/50/75%, profile visitors, ad interactions) живуть всередині walled garden Meta і не страждають від трекінг-обмежень. Розбиття однієї купи на «драбину інтенту» (engagers → viewers 75% → visitors LP → initiated checkout) з окремими меседжами дає +40–70% ROAS ремаркетингу без зростання бюджету `[практики]`.
🎯 **DreamCar:** ваші стріми = потужне джерело video viewers. Сегменти: (1) viewers 75% відео фіналів (найгарячіші не-покупці), (2) IG engagers 30д, (3) LP visitors без покупки 7д. Кожному — свій меседж: 75%-viewers — «наступний фінал уже скоро», LP-visitors — вхідний тариф 49–199.
Джерела: [Infront Marketing — Retargeting 2026](https://infrontmarketing.ca/blog/search-engine-optimization/meta-retargeting-after-privacy-changes-what-still-works-and-what-to-replace/), [growwithsakib — Custom Audiences](https://growwithsakib.com/meta-custom-audiences/), [Digital Applied — Custom Audience Filters](https://www.digitalapplied.com/blog/meta-custom-audience-filters-retargeting-engagement-frequency)

**6.4. TG-канал як source: нативного способу немає, білий обхід — через дані і CAPI.**
⚠️ Якісних кейс-джерел мало (тема нішева, статті поверхневі). Робочі патерни: (1) TG-бот збирає phone/email при взаємодії → регулярний upload у customer list CA; (2) кастомна CAPI-подія «ChannelJoin»/Subscribe з проміжного LP при вступі → website CA + оптимізаційний сигнал; (3) весь трафік «ads → TG» вести через короткий LP-місток (ловить pixel + «продає» канал), а не голим t.me-лінком.
🎯 **DreamCar:** ви вже маєте tg_chat_id у dashboard users — це готовий міст: matched-список TG-підписників, які є юзерами, можна сегментувати (підписник без покупки 30д → окремий ремаркетинг). Краще за engagement audiences це не стане, але доповнює драбину 6.3 знизу.
Джерела (слабкі, практичні): [SaveMyLeads — FB Ads for Telegram](https://savemyleads.com/blog/other/how-to-run-facebook-ads-for-telegram-channel), [TG Tracker — FB Ads Guide](https://tgtracker.io/blog/en/skyrocket-telegram-channel-growth-facebook-ads-guide)

---

## 7. UA-ринок 2026: CPM, сезонність H2

**Контекст (найякісніше UA-джерело — Admixer Advertising Meetup, березень 2026, дані рекламних кабінетів):**

| Показник UA | Значення | Динаміка |
|---|---|---|
| Охоплення Meta | 21,2 млн (>50% населення) | +6% vs Q1 2024 |
| Instagram MAU | 13,2 млн | +7% |
| Частка охоплення | FB 38% / IG 34% | — |
| Гендер | Жінки 58% / чоловіки 42% | — |
| CPM (середній по ринку) | **$0,46** (2025) | **−2% р/р** |
| CPC | **$0,10** | **+11% р/р** |
| Частка Reels у spend | 30–31% | зростає |
| Топ-витрати Q4 2025 | **Auto 17%**, CPG 13%, Real Estate 9% | — |

⚠️ **Розбіжність джерел по CPM:** Admixer дає $0,46 (середнє по всіх типах кампаній, включно з охопленням), українські агенції оперують $4–5 CPM для конверсійних кампаній ([Rabbit Marketing](https://rabbitmarketing.com.ua/targeting/skilky-koshtuie-tarhetovana-reklama/), [PricesUA](https://pricesua.com/vartist-targetovanoi-reklamy-2026/)). Для планування DreamCar орієнтуватись на власні дані акаунта, зовнішні цифри — лише як напрямок тренду.

### Висновки для DreamCar

**7.1. Аукціонний тиск на вашу ЦА створює автосектор.**
Auto — сектор №1 за витратами в UA Meta (17% у Q4 2025). Автодилери/маркетплейси б'ються за тих самих чоловіків 25–44. Практичний наслідок: у періоди автомобільних промо-хвиль (весна, Q4) ваш CPM ростиме сильніше за ринок.
🎯 Дія: тримати CPM-тренд по місяцях у щоденному аудиті і планувати найагресивніші запуски там, де аукціон дешевший (7.2).
Джерело: [AIN.ua/Admixer](https://ain.ua/2026/03/11/trendy-reklamy-meta-ukraina-2026/)

**7.2. Сезонність H2: серпень — дешеве вікно, жовтень→грудень — ескалація, BF-тиждень 2–3x.**
Глобальні дані (UA слідує патерну): CPM росте з жовтня, пік у листопаді (у US 2025 пік $27,40), на BF/CM — 2–3x річного бейслайну; Q4 у ритейлі +25–40% CPM; грудень в UA традиційно найдорожчий місяць таргету. Загальний тренд 2025→2026: +8–12% CPM р/р глобально.
🎯 **DreamCar-календар H2 2026:** (1) серпень–вересень — максимізувати acquisition нових учасників (дешевий аукціон, будування бази перед Q4); (2) жовтень — великий запуск ДО ескалації CPM; (3) листопад — фінал планувати НЕ на BF-тиждень (24.11–01.12): або до 20.11, або на початок грудня; (4) грудень — ставка на ремаркетинг бази (дешевший за prospecting у дорогому аукціоні) + бліци для монетизації бази.
Джерела: [Stackmatix — FB Ads Cost 2026](https://www.stackmatix.com/blog/facebook-ads-cost-complete-guide), [SuperAds — CPM benchmarks](https://www.superads.ai/facebook-ads-costs/cpm-cost-per-mille/united-states), [Adligator — CPM by Country](https://adligator.com/blog/meta-ads-cpm-by-country-benchmarks), [Rabbit Marketing](https://rabbitmarketing.com.ua/targeting/skilky-koshtuie-tarhetovana-reklama/)

**7.3. Драйвери UA-ринку 2026 за Admixer: CAPI, Partnership Ads, GenAI.**
Три технологічні пріоритети, які Admixer називає фундаментом для UA-рекламодавців у 2026: Conversions API, Partnership Ads (реклама від імені інфлюенсерів), генеративний AI в Ads Manager. CAPI у вас є; Partnership Ads і GenAI — див. розділ 8.
Джерело: [AIN.ua/Admixer](https://ain.ua/2026/03/11/trendy-reklamy-meta-ukraina-2026/)

---

## 8. Нові інструменти 2026, які ви можливо не використовуєте

### Тактики (відсортовано за релевантністю для токен-продукту)

**8.1. Partnership Ads — найперспективніший невикористаний інструмент.**
З грудня 2025 Meta розширила Partnership Ads Hub в Ads Manager (весь creator-контент, що тегає бренд, в одному фіді з органічними метриками); за повідомленнями, creator-контент у рекламі тепер зобов'язаний іти через формат Partnership Ads. Бенчмарки: −19% CPA і +53% CTR vs стандартні ads `[практики, посилаються на Meta Business Insights 2026]`; creator-хендл замість бренд-хендла дає до 4x CTR.
🎯 **DreamCar:** у вас є унікальний пул «крієйторів» — **переможці 16 авто**. Патерн: переможець постить відео з авто у своєму IG → allowlist через Partnership Ads → ви запускаєте його пост як рекламу від його імені з вашим таргетингом і бюджетом. Соціальний доказ у найчистішому вигляді + обхід банерної сліпоти до бренд-акаунтів. Додатково — колаби з UA-автоблогерами на фінали-стріми. ⚠️ Контент переможців має проходити той самий compliance-фільтр формулювань (розділ 5).
Джерела: [Influencer Hero — Whitelisting & Partnership Ads 2026](https://www.influencer-hero.com/resources/guide-to-whitelisting-meta-partnership-ads), [Flighted — Partnership Ads](https://www.flighted.co/blog/how-to-use-partnership-ads-on-meta), [ContentGrip — mandatory rules](https://www.contentgrip.com/meta-branded-content-rules-update/), [AIN.ua/Admixer](https://ain.ua/2026/03/11/trendy-reklamy-meta-ukraina-2026/)

**8.2. Threads ads: дешеве охоплення, увімкнути і моніторити.**
Глобальний розкат завершено (2026), 450M MAU; CPM на 15–40% нижчий за Instagram `[практики]`; тільки mobile; включається як placement у існуючі кампанії за 15 хвилин. ⚠️ Ризики: можлива канібалізація IG/FB-видачі; середній час у застосунку лише ~34 хв/міс — конверсійність під питанням.
🎯 **DreamCar:** якщо Advantage+ placements увімкнені — Threads уже може отримувати покази; перевірити breakdown by placement. Дія: явно увімкнути Threads placement на prospecting, 2–4 тижні спостерігати CPM/CPA у розрізі placement (utm_medium={{placement}} уже налаштований — реальний ROAS по Threads буде видно у дашборді). Лишити якщо CPA ≤ середнього.
Джерела: [Digital Applied — Threads Ads Guide](https://www.digitalapplied.com/blog/meta-threads-ads-400m-users-guide-2026), [PPC Land — Threads global rollout](https://ppc.land/meta-finally-brings-threads-ads-to-every-user-after-yearlong-testing-phase/), [JumpFly](https://www.jumpfly.com/blog/threads-ads-go-global-what-meta-advertisers-need-to-know/)

**8.3. Meta GenAI creative tools: масштабування варіацій перевірених переможців.**
Доступно у 2026: image-to-video (до 20 фото → мульти-сценне відео), image animation, AI-фони, AI-музика під тон креативу, persona-based image generation (версії оголошення під різні аудиторії), AI dubbing. Дані Meta: adopters Advantage+ creative +22% ROAS; image gen +11% CTR, +7,6% CVR; text gen +3% CTR `[Meta]`.
🎯 **DreamCar:** використовувати НЕ для генерації нових концепцій (у вас сильний реальний контент — авто, стріми, переможці), а для **розмноження варіацій переможців**: фото переданих авто → image-to-video анімації; AI-фони для статик з тарифами; персона-версії одного оголошення. Обов'язково AI-disclosure чекбокс (2.5). Це прямо годує Andromeda різноманітністю з мінімальною вартістю продакшену.
Джерела: [Meta — Advantage+ Creative](https://www.facebook.com/business/ads/meta-advantage-plus/creative), [SearchEngineLand — GenAI tools](https://searchengineland.com/meta-generative-ai-tools-automated-video-branding-creative-ads-457221), [AdTaxi — Meta AI Plans 2026](https://www.adtaxi.com/blog/metas-ai-advertising-plans-what-to-expect-in-2026-and-how-to-prepare/), [Meta Engineering](https://engineering.fb.com/2024/12/02/production-engineering/meta-andromeda-advantage-automation-next-gen-personalized-ads-retrieval-engine/)

**8.4. Sitelink ads + promo code ads — дрібні формати з прямим ефектом на CTR/CVR.**
Sitelinks: кілька лінків в одному оголошенні (різні розділи сайту). Promo code ads: промокод прямо в оголошенні без ручного вводу.
🎯 **DreamCar:** sitelinks на prospecting: «Як це працює» / «Переможці (16 авто)» / «Поточний запуск» / «Тарифи» — знімає одразу два бар'єри (недовіра + нерозуміння продукту). Promo code — інструмент для бліців (код на бонусні токени першої покупки) — якщо формат доступний в UA-акаунті, тест у наступному бліці.
Джерела: [Dataslayer — Meta new formats](https://www.dataslayer.ai/blog/boost-your-holiday-campaigns-with-meta-ads-new-formats), [Swipe Insight — Meta updates](https://web.swipeinsight.app/topics/meta-ads)

**8.5. Click-to-Messenger/WhatsApp flows — низький пріоритет для UA.**
CTWA — найшвидше зростаючий формат глобально з агресивними vendor-заявами (конверсія у рази вища за лендинг-фанели `[практики, vendor-bias — цифрам на кшталт «ROWAS 57x» не довіряти]`). ⚠️ Але: WhatsApp в Україні слабкий, ваша аудиторія живе у Telegram, а click-to-Telegram формату у Meta немає.
🎯 **DreamCar:** не пріоритет. Єдиний осмислений тест — click-to-Messenger для сегмента «LP visitors без покупки» з квіз-флоу «підбери тариф» (72h безкоштовне вікно повідомлень). Тільки після впровадження пунктів вище.
Джерела: [Infobip — CTWA](https://www.infobip.com/blog/click-to-whatsapp-ads), [Benly — Click-to-WhatsApp/Messenger](https://benly.ai/learn/meta-ads/click-to-whatsapp-messenger-ads)

**8.6. Shops / lead-to-purchase — не застосовно.**
Shops-checkout для цифрових токенів в UA не працює; lead ads (включно з новим integrated booking) — для лід-генів, не для транзакційного продукту з чекаутом. Пропустити.

---

## Топ-10 до впровадження у DreamCar

| # | Тактика | Impact | Effort | Розділ | Перший крок |
|---|---------|--------|--------|--------|-------------|
| 1 | **Partnership Ads з переможцями** (allowlist постів переможців з авто → реклама від їх імені) | 🔴 High | 🟡 Medium | 8.1 | Зв'язатися з 3–5 останніми переможцями, отримати partnership-доступ до 1 поста кожного |
| 2 | **Playbook фінального вікна**: прогрів final-sprint кампанії за 5–7 днів (lifetime budget + розклад), масштабування лише +20%/48h у навчені ад-сети | 🔴 High | 🟢 Low | 3.3, 4.1 | Вписати у чеклист наступного запуску; кампанія фіналу створюється на Д-7 |
| 3 | **Креатив-конвеєр**: 3–5 нових концепцій/тиждень за матрицею персона × кут × формат; ×3–4 запас на фінальні 72h | 🔴 High | 🟡 Medium | 2.1, 3.4 | Скласти матрицю 4 персони × 4 кути; закріпити тижневу квоту |
| 4 | **Compliance-пакет LP**: правила/умови доступні до входу, Meta-дисклеймер, продукт-перший фрейминг, реєстр 16 авто, 2–3 LP-варіанти | 🔴 High (зниження ризику) | 🟢 Low | 5.1–5.4 | Аудит поточного LP проти чекліста розділу 5 |
| 5 | **Нічний автосинк аудиторій із Supabase**: purchasers (exclusion), top-20% LTV, current cycle — через Marketing API | 🟠 Med-High | 🟢 Low (ETL вже є) | 6.2 | GH Action workflow: Supabase → Custom Audiences API |
| 6 | **Engagement-драбина ремаркетингу**: viewers 75% стрімів / IG engagers 30д / LP visitors 7д — окремі меседжі | 🟠 Med-High | 🟢 Low | 6.3 | Створити 3 CA + 3 ад-сети з диференційованими креативами |
| 7 | **Hook rate у щоденний аудит** + A/B трьох типів хуків (Meta-фреймворк), звук у всіх Reels | 🟠 Medium | 🟢 Low | 2.4 | Додати 3-sec views/impressions у creative_audit_log |
| 8 | **Min ROAS тест у фінальному вікні** (таргет = поточний ROAS вікна × 1.1) + value rules на чоловіків 35–54 поверх cost cap ремаркетингу | 🟠 Medium | 🟡 Medium | 3.2, 6.1 | Перевірити чистоту value у CAPI, 1 value-optimized ад-сет у наступний фінал |
| 9 | **GenAI-розмноження переможців**: image-to-video з фото передач, persona-версії, AI-фони + AI-disclosure | 🟠 Medium | 🟢 Low | 8.3, 2.5 | Взяти топ-3 креативи за ROAS, згенерувати по 3 варіації |
| 10 | **Threads placement + sitelinks**: увімкнути, моніторити через utm_medium={{placement}} у дашборді | 🟡 Medium-Low | 🟢 Low | 8.2, 8.4 | Увімкнути placement, додати sitelinks на prospecting |

**Календарний акцент H2 2026 (розділ 7):** серпень–вересень = дешеве вікно acquisition → великий запуск у жовтні до ескалації CPM → фінал листопада ПОВЗ BF-тиждень → грудень = ремаркетинг бази + бліци.

---

## Обмеження дослідження

1. **Якість джерел нерівномірна.** Офіційних даних Meta мало (Engineering Blog, Marketing Blog через SMT, Help Center); більшість «2026 guides» — контент-маркетинг агенцій/тулів. Цифри типу «+65% ROAS при 20+ ads/міс» чи «similarity >60% = suppression» — не верифіковані Meta, використовувати як напрямок, не як константи.
2. **CTWA-бенчмарки сильно vendor-inflated** (розділ 8.5) — свідомо позначені.
3. **UA CPM: розбіжність $0,46 (Admixer) vs $4–5 (агенції)** — різні методології; для рішень використовувати власні дані акаунта.
4. **«TG-канал як source»** — якісних кейсів у відкритих джерелах не знайдено; рекомендації 6.4 зібрані з практичних патернів, не з верифікованих кейсів.
5. **Partnership Ads «mandatory»** (ContentGrip) — вимагає верифікації у власному Ads Manager перед закладанням у процеси.
6. Дані про сезонність Q4 — переважно глобальні/US; UA-специфіку (грудень найдорожчий) підтверджує лише одне агентське джерело.
