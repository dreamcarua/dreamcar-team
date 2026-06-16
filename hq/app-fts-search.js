/* ============================================================
   DreamCar HQ — Full-Text Search (G6 + v1.1★ #1)
   ============================================================ */
// Замінює client-side title/text фільтр на Postgres tsvector через
// supabase.from('publications').textSearch('search_tsv', q).
// Це швидше для >500 публікацій. Працює тільки коли HQ_BACKEND=true.
// На demo-режимі фолбек на старий filteredPubs().

(function () {
  if (window.__hqFtsLoaded) return;
  window.__hqFtsLoaded = true;

  window.searchPubsFts = async function (query, limit) {
    limit = limit || 50;
    if (!query || query.trim().length < 2) return [];
    if (!window.HQ_BACKEND || !window.supabase) {
      var s = (typeof Store !== 'undefined') ? Store : null;
      if (!s || !s.pubs) return [];
      var ql = query.toLowerCase();
      return s.pubs().filter(function (p) {
        return p && !p._trashed && (
          (p.title || '').toLowerCase().indexOf(ql) >= 0 ||
          (p.text || '').toLowerCase().indexOf(ql) >= 0 ||
          (p.hashtags || []).some(function (h) { return String(h || '').toLowerCase().indexOf(ql) >= 0; })
        );
      }).slice(0, limit);
    }

    var resp = await window.supabase
      .from('publications')
      .select('id, title, text, status, publish_at, deadline_on, platforms:publication_platforms(platform)')
      .textSearch('search_tsv', query, { type: 'websearch', config: 'simple' })
      .is('deleted_at', null)
      .limit(limit);
    if (resp.error) {
      console.error('FTS error:', resp.error);
      return [];
    }
    return resp.data || [];
  };

  function wireSearch() {
    var input = document.getElementById('globalSearch');
    if (!input || input.dataset.ftsWired) return;
    input.dataset.ftsWired = '1';

    var t;
    input.addEventListener('input', function () {
      clearTimeout(t);
      var q = input.value;
      t = setTimeout(async function () {
        if (!q || q.length < 2) {
          if (typeof window.App !== 'undefined') {
            window.App.searchQuery = '';
            window._ftsResults = null;
            if (typeof renderCalBody === 'function') renderCalBody();
          }
          return;
        }
        if (window.HQ_BACKEND && window.supabase) {
          var results = await window.searchPubsFts(q, 100);
          if (typeof window.App !== 'undefined') {
            window.App.searchQuery = q;
            window.App.calendarMode = 'list';
            window._ftsResults = results.map(function (r) {
              return Object.assign({}, r, {
                dateTime: r.publish_at,
                deadline: r.deadline_on,
                platforms: (r.platforms || []).map(function (pp) { return pp.platform; }),
              });
            });
            if (typeof renderCalendar === 'function') {
              renderCalendar(document.getElementById('main'));
            }
          }
        }
      }, 300);
    });
  }
  setTimeout(wireSearch, 800);
  setTimeout(wireSearch, 2500);

  function patchFilteredPubs() {
    if (typeof window.filteredPubs !== 'function' || window.filteredPubs.__ftsPatched) return;
    var _orig = window.filteredPubs;
    window.filteredPubs = function () {
      if (window._ftsResults && window._ftsResults.length && window.App && window.App.searchQuery) {
        return window._ftsResults;
      }
      return _orig.apply(this, arguments);
    };
    window.filteredPubs.__ftsPatched = true;
  }
  setTimeout(patchFilteredPubs, 600);
  setTimeout(patchFilteredPubs, 2000);

  if (window.DEBUG) console.log('%cDreamCar HQ FTS %c· tsvector search wired', 'color:#7ab0ff;font-weight:700;', 'color:#888;');
})();
