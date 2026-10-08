(function () {
  'use strict';

  var doc = document;
  var win = window;
  var reduced = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function $(sel, root) { return (root || doc).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); }

  // ---------- register (single source of external facts) ----------
  var register = {};
  try { register = JSON.parse($('#register').textContent); } catch (e) { register = {}; }
  function rec(name) { return register[name] || { state: 'absent', value: null, url: null }; }
  function stated(name) { var r = rec(name); return r.state === 'stated' && r.value != null; }

  // ---------- helpers ----------
  var DASH = '—';
  var nfInt = new Intl.NumberFormat('en-US');
  var nfCompact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });

  function fmtUsd(n) {
    if (!isFinite(n)) return DASH;
    if (n >= 1000) return '$' + nfCompact.format(n);
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPrice(n) {
    if (!isFinite(n)) return DASH;
    if (n >= 1) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    if (n === 0) return '$0';
    var digits = Math.min(12, 3 - Math.floor(Math.log10(n)));
    return '$' + n.toFixed(digits).replace(/0+$/, '');
  }
  function fmtPct(n) {
    if (!isFinite(n)) return DASH;
    return Math.abs(n).toFixed(2) + '%';
  }

  // Exponential backoff: base * 2^fails, capped, with jitter. Pure so the gates can call it.
  function backoff(fails, base, cap, rnd) {
    var r = typeof rnd === 'number' ? rnd : Math.random();
    var raw = Math.min(cap, base * Math.pow(2, Math.max(0, fails)));
    return Math.round(raw * (0.85 + 0.3 * r));
  }

  function poller(opts) {
    var fails = 0, timer = null, stopped = false, ctl = null;
    function schedule(ms) { if (!stopped) timer = setTimeout(run, ms); }
    function run() {
      if (doc.hidden) {
        var wake = function () { if (!doc.hidden) { doc.removeEventListener('visibilitychange', wake); if (!stopped) run(); } };
        doc.addEventListener('visibilitychange', wake);
        return;
      }
      ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var kill = ctl ? setTimeout(function () { ctl.abort(); }, opts.timeout || 8000) : null;
      Promise.resolve()
        .then(function () { return opts.task(ctl ? ctl.signal : undefined); })
        .then(function (data) {
          clearTimeout(kill); fails = 0; opts.onOk(data); schedule(opts.interval);
        }, function (err) {
          clearTimeout(kill); fails += 1;
          var wait = backoff(fails, opts.interval, opts.cap || 60000);
          opts.onFail(err, wait, fails); schedule(wait);
        });
    }
    run();
    return { stop: function () { stopped = true; clearTimeout(timer); if (ctl) ctl.abort(); } };
  }

  // ---------- toast ----------
  var toastEl = $('#toast'), toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  function copyText(text) {
    if (win.navigator.clipboard && win.isSecureContext) {
      return win.navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = doc.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        doc.body.appendChild(ta); ta.select();
        var ok = doc.execCommand('copy'); doc.body.removeChild(ta);
        ok ? resolve() : reject(new Error('copy refused'));
      } catch (e) { reject(e); }
    });
  }
  function copyWithToast(text, label, btn) {
    copyText(text).then(function () {
      toast(label + ' copied');
      if (btn) { btn.classList.add('is-done'); setTimeout(function () { btn.classList.remove('is-done'); }, 1200); }
    }, function () { toast('Copy blocked by the browser'); });
  }

  // ---------- CA slot (inert until the record is stated) ----------
  (function () {
    var btn = $('#ca-btn');
    if (!btn) return;
    if (!stated('ca')) { btn.setAttribute('aria-disabled', 'true'); return; }
    var addr = rec('ca').value;
    btn.addEventListener('click', function () { copyWithToast(addr, 'Contract address', btn); });
  })();

  // ---------- number display with count-up and flash ----------
  function flash(el) {
    if (reduced) return;
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }
  function countTo(el, from, to, fmt, ms) {
    if (reduced || from === to || !isFinite(from)) { el.textContent = fmt(to); return; }
    var t0 = performance.now();
    function step(now) {
      var k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step); else el.textContent = fmt(to);
    }
    requestAnimationFrame(step);
  }
  function tileState(name, state, note) {
    var t = $('[data-tile="' + name + '"]');
    if (!t) return;
    t.setAttribute('data-state', state);
    if (note != null) { var n = $('.tile-note', t); if (n) n.textContent = note; }
  }
  var shown = {};
  function setTile(name, valueEl, value, fmt) {
    var el = $(valueEl);
    var prev = shown[name];
    shown[name] = value;
    if (typeof value === 'number' && typeof prev === 'number' && prev !== value) {
      countTo(el, prev, value, fmt, 600); flash(el);
    } else {
      el.textContent = fmt(value);
    }
  }
  function setDash(name, valueEl, note) {
    var el = $(valueEl);
    shown[name] = undefined;
    el.textContent = DASH;
    tileState(name, 'error', note);
  }

  // ---------- block height ----------
  var blockCfg = { endpoint: rec('rpc').value, lastReal: null, lastAt: 0, rate: 2.5, display: null };
  function rpcHeight(signal) {
    return fetch(blockCfg.endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBlockHeight', params: [{ commitment: 'confirmed' }] })
    }).then(function (r) {
      if (!r.ok) throw new Error('rpc http ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || j.error || typeof j.result !== 'number') throw new Error('rpc payload');
      return j.result;
    });
  }
  var pill = $('#status-pill'), pillText = $('#pill-text');
  function setPill(state, text) { if (!pill) return; pill.setAttribute('data-state', state); pillText.textContent = text; }

  function startBlock() {
    if (!blockCfg.endpoint) { setDash('block', '#v-block', 'No RPC source on record'); setPill('down', 'Offline'); return; }
    var valEl = $('#v-block');
    var tick = null;
    function paint(n) { valEl.textContent = nfInt.format(n); }
    poller({
      interval: 2000, cap: 60000, timeout: 6000,
      task: rpcHeight,
      onOk: function (h) {
        var now = performance.now();
        if (blockCfg.lastReal != null && now > blockCfg.lastAt) {
          var r = (h - blockCfg.lastReal) / ((now - blockCfg.lastAt) / 1000);
          if (r >= 0 && r < 12) blockCfg.rate = blockCfg.rate * 0.5 + r * 0.5;
        }
        var changed = blockCfg.display !== h;
        blockCfg.lastReal = h; blockCfg.lastAt = now; blockCfg.display = h;
        paint(h); if (changed) flash(valEl);
        tileState('block', 'ok', 'Confirmed commitment, checked every 2 s');
        setPill('live', 'Live');
        if (!reduced && !tick) {
          tick = setInterval(function () {
            if (blockCfg.lastReal == null) return;
            var est = blockCfg.lastReal + Math.floor(blockCfg.rate * (performance.now() - blockCfg.lastAt) / 1000);
            if (est > blockCfg.display) { blockCfg.display = est; paint(est); }
          }, 250);
        }
      },
      onFail: function (err, wait) {
        if (tick) { clearInterval(tick); tick = null; }
        blockCfg.lastReal = null; blockCfg.display = null;
        setDash('block', '#v-block', 'RPC unreachable. Retrying in ' + Math.round(wait / 1000) + ' s');
        setPill('down', 'Offline');
      }
    });
  }

  // ---------- DexScreener pairs ----------
  var dexUrl = rec('dex').value;
  var dexFallbackUrl = rec('dexFallback').value;
  var SYMS = { copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V6a2 2 0 0 1 2-2h8"></path></svg>' };

  function pickPairs(json) {
    var list = (json && json.pairs) || [];
    var ca = stated('ca') ? rec('ca').value : null;
    return list.filter(function (p) {
      if (!p || p.chainId !== 'solana' || !p.baseToken) return false;
      if (ca) return p.baseToken.address === ca;
      var hay = ((p.baseToken.symbol || '') + ' ' + (p.baseToken.name || '')).toLowerCase();
      return hay.indexOf('deskless') !== -1;
    }).sort(function (a, b) {
      return ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0);
    });
  }

  function hashStr(s) { var x = 5381; for (var i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) >>> 0; return x; }

  // No image: a circle with two initials, tone picked from a hash of the symbol (palette tones only, see .tone-* in styles.css)
  function initialsNode(p, small) {
    var box = doc.createElement('span');
    box.className = 'logo tone-' + (hashStr(p.baseToken.symbol || '?') % 8) + (small ? ' logo-sm' : '');
    box.textContent = (p.baseToken.symbol || '?').slice(0, 2).toUpperCase();
    return box;
  }
  function logoNode(p, small) {
    var url = (p.info && p.info.imageUrl) || p.baseToken.logoURI;
    if (!url || !/^https:\/\//.test(url)) return initialsNode(p, small);
    var img = doc.createElement('img'), px = small ? 24 : 32;
    img.className = 'logo' + (small ? ' logo-sm' : ''); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    img.width = px; img.height = px; img.src = url;
    img.addEventListener('error', function () { img.replaceWith(initialsNode(p, small)); });
    return img;
  }

  // Fallback board: busiest Solana pools by 24h volume, one row per token, top 8.
  function pickTrending(json) {
    var seen = {};
    return ((json && json.pairs) || [])
      .filter(function (p) { return p && p.chainId === 'solana' && p.baseToken && p.baseToken.address; })
      .sort(function (a, b) { return (Number(b.volume && b.volume.h24) || 0) - (Number(a.volume && a.volume.h24) || 0); })
      .filter(function (p) { if (seen[p.baseToken.address]) return false; seen[p.baseToken.address] = 1; return true; })
      .slice(0, 8);
  }

  // own: pairs matching Deskless (drives the tiles). board: what the table and marquee list (own, or the trending fallback).
  function renderPairs(own, board, mode) {
    var wrap = $('#pairs'), body = $('#pairs-body'), note = $('#pairs-note'), label = $('#pairs-label');
    var mq = $('#marquee'), track = $('#marquee-track'), mqNote = $('#marquee-note');
    body.textContent = ''; track.textContent = '';
    wrap.setAttribute('data-mode', mode);
    label.hidden = mode !== 'trending';
    renderTiles(own);

    if (!board.length) {
      wrap.setAttribute('data-state', 'empty');
      var card = doc.createElement('div'); card.className = 'empty-card';
      card.innerHTML = '<span class="empty-dash">' + DASH + '</span><strong>No pairs listed yet</strong><span>The feed answered, and nothing on Solana matches this name. Rows appear here the moment a pool does.</span>';
      body.appendChild(card);
      note.textContent = 'Source: DexScreener search, refreshed every 30 s.';
      mq.setAttribute('data-state', 'empty'); mqNote.hidden = false; mqNote.textContent = 'No token logos to show yet.';
      return;
    }

    wrap.setAttribute('data-state', 'ok');
    note.textContent = mode === 'trending'
      ? 'No Deskless pair is listed yet, so this board follows the busiest Solana pools. It swaps itself out the moment one appears. Refreshed every 30 s.'
      : 'Source: DexScreener search, refreshed every 30 s.';
    board.forEach(function (p) {
      var row = doc.createElement('div'); row.className = 'row'; row.setAttribute('data-spot', '');
      var tok = doc.createElement('div'); tok.className = 'cell-token';
      tok.appendChild(logoNode(p, false));
      var nm = doc.createElement('div'); nm.className = 'tk-name';
      var s1 = doc.createElement('span'); s1.className = 'tk-sym'; s1.textContent = p.baseToken.symbol || DASH;
      var s2 = doc.createElement('span'); s2.className = 'tk-sub'; s2.textContent = (p.baseToken.name || '') + ' / ' + ((p.quoteToken && p.quoteToken.symbol) || '') + ' on ' + (p.dexId || 'dex');
      nm.appendChild(s1); nm.appendChild(s2); tok.appendChild(nm);
      var met = doc.createElement('div'); met.className = 'cell-metrics';
      var price = Number(p.priceUsd), chg = p.priceChange && Number(p.priceChange.h24), vol = p.volume && Number(p.volume.h24);
      function metric(lbl, text, cls) { var s = doc.createElement('span'); var sm = doc.createElement('small'); sm.textContent = lbl; var v = doc.createElement('b'); v.style.fontWeight = '500'; v.textContent = text; if (cls) v.className = cls; s.appendChild(sm); s.appendChild(v); return s; }
      met.appendChild(metric('Price', isFinite(price) && p.priceUsd != null ? fmtPrice(price) : DASH));
      met.appendChild(metric('Day', isFinite(chg) && p.priceChange ? fmtPct(chg) : DASH, isFinite(chg) ? (chg >= 0 ? 'chg-up' : 'chg-down') : ''));
      met.appendChild(metric('Volume', isFinite(vol) && p.volume ? fmtUsd(vol) : DASH));
      var btn = doc.createElement('button'); btn.type = 'button'; btn.className = 'copy-btn';
      btn.setAttribute('aria-label', 'Copy ' + (mode === 'trending' ? 'token' : 'pair') + ' address for ' + (p.baseToken.symbol || 'token'));
      btn.innerHTML = SYMS.copy + '<span>Copy</span>';
      // trending rows copy the token address (that is what a reader wants from a list of coins); own rows copy the pair address
      var addr = mode === 'trending' ? p.baseToken.address : p.pairAddress;
      btn.addEventListener('click', function () { copyWithToast(addr, mode === 'trending' ? 'Token address' : 'Pair address', btn); });
      row.appendChild(tok); row.appendChild(met); row.appendChild(btn);
      body.appendChild(row);
    });

    // marquee: logo, symbol, dot, price. Doubled for a seamless loop.
    var items = board.slice(0, 12);
    var reps = Math.max(2, Math.ceil(8 / items.length) * 2);
    for (var i = 0; i < reps; i++) {
      items.forEach(function (p) {
        var it = doc.createElement('span'); it.className = 'mq-item';
        if (i >= reps / 2) it.setAttribute('aria-hidden', 'true');
        it.appendChild(logoNode(p, true));
        var t = doc.createElement('span'); t.className = 'mq-sym'; t.textContent = p.baseToken.symbol || DASH;
        var d = doc.createElement('span'); d.className = 'mq-dot'; d.textContent = '·';
        var pr = doc.createElement('span'); pr.className = 'mq-price'; pr.textContent = p.priceUsd != null && isFinite(Number(p.priceUsd)) ? fmtPrice(Number(p.priceUsd)) : DASH;
        it.appendChild(t); it.appendChild(d); it.appendChild(pr);
        track.appendChild(it);
      });
    }
    track.style.setProperty('--marquee-dur', Math.max(20, items.length * reps * 3) + 's');
    mq.setAttribute('data-state', 'ok'); mqNote.hidden = true;
  }

  function renderTiles(pairs) {
    if (!pairs.length) {
      tileState('pairs', 'ok', 'Feed answered with zero Solana matches');
      setTile('pairs', '#v-pairs', 0, function (n) { return nfInt.format(n); });
      tileState('volume', 'ok', 'Nothing listed to sum');
      setTile('volume', '#v-volume', 0, fmtUsd);
      shown.price = undefined; $('#v-price').textContent = DASH; tileState('price', 'ok', 'No pool to quote yet');
      return;
    }
    var total = pairs.reduce(function (s, p) { return s + (Number(p.volume && p.volume.h24) || 0); }, 0);
    var lead = pairs[0];
    tileState('pairs', 'ok', 'Solana pools matching the name');
    setTile('pairs', '#v-pairs', pairs.length, function (n) { return nfInt.format(Math.round(n)); });
    tileState('volume', 'ok', 'Summed over every listed pair');
    setTile('volume', '#v-volume', total, fmtUsd);
    tileState('price', 'ok', lead.priceChange && isFinite(Number(lead.priceChange.h24)) ? ((Number(lead.priceChange.h24) >= 0 ? 'Up ' : 'Down ') + fmtPct(Number(lead.priceChange.h24)) + ' across the day') : 'Deepest pool by liquidity');
    setTile('price', '#v-price', Number(lead.priceUsd), fmtPrice);
  }


  function pairsFailed(err, wait) {
    var secs = Math.round(wait / 1000);
    var msg = 'DexScreener unreachable. Retrying in ' + secs + ' s';
    $('#pairs').setAttribute('data-state', 'error');
    $('#pairs-label').hidden = true;
    $('#pairs-body').textContent = '';
    var card = doc.createElement('div'); card.className = 'empty-card';
    card.innerHTML = '<span class="empty-dash">' + DASH + '</span><strong>Market feed unavailable</strong><span></span>';
    card.lastChild.textContent = msg + '.';
    $('#pairs-body').appendChild(card);
    $('#pairs-note').textContent = msg;
    $('#marquee-track').textContent = '';
    $('#marquee').setAttribute('data-state', 'error');
    var mqn = $('#marquee-note'); mqn.hidden = false; mqn.textContent = DASH + '  ' + msg;
    setDash('pairs', '#v-pairs', msg);
    setDash('volume', '#v-volume', msg);
    setDash('price', '#v-price', msg);
  }

  function getJson(url, signal) {
    return fetch(url, { signal: signal, headers: { accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('dex http ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || !Array.isArray(j.pairs)) throw new Error('dex payload');
      return j;
    });
  }

  // Tier 1: search the name. Tier 2 (only when tier 1 answers with zero matches): Solana trending.
  // A tier-2 failure is not an outage of the main feed, so it falls back to the honest empty state.
  function startPairs() {
    if (!dexUrl) { pairsFailed(new Error('no source'), 0); return; }
    poller({
      interval: 30000, cap: 300000, timeout: 10000,
      task: function (signal) {
        return getJson(dexUrl, signal).then(function (j) {
          var own = pickPairs(j);
          if (own.length || !dexFallbackUrl) return { own: own, board: own, mode: 'own' };
          return getJson(dexFallbackUrl, signal).then(function (f) {
            var trending = pickTrending(f);
            return { own: own, board: trending, mode: trending.length ? 'trending' : 'own' };
          }, function () { return { own: own, board: own, mode: 'own' }; });
        });
      },
      onOk: function (r) { renderPairs(r.own, r.board, r.mode); },
      onFail: pairsFailed
    });
  }

  // ---------- spring physics: sample a damped spring into a linear() easing ----------
  function springEasing(stiffness, damping, mass) {
    var w0 = Math.sqrt(stiffness / mass), zeta = damping / (2 * Math.sqrt(stiffness * mass));
    var wd = w0 * Math.sqrt(1 - zeta * zeta), pts = [], N = 48, T = 1.1;
    for (var i = 0; i <= N; i++) {
      var t = (i / N) * T;
      var v = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t));
      pts.push(+v.toFixed(4));
    }
    pts[N] = 1;
    return { easing: 'linear(' + pts.join(', ') + ')', duration: T * 1000 };
  }
  var SPRING = springEasing(170, 15, 1);
  var supportsLinear = !!(win.CSS && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)'));

  function reveal(el, delay) {
    if (reduced || !el.animate) { el.classList.add('in'); return; }
    var anim = el.animate(
      [{ opacity: 0, transform: 'translateY(26px) scale(.985)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }],
      { duration: supportsLinear ? SPRING.duration : 620, delay: delay, easing: supportsLinear ? SPRING.easing : 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }
    );
    el.classList.add('in');
    anim.addEventListener('finish', function () { anim.cancel(); });
  }

  function setupReveal() {
    var els = $all('[data-reveal]');
    if (reduced || !('IntersectionObserver' in win)) { els.forEach(function (e) { e.classList.add('in'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      var batch = entries.filter(function (e) { return e.isIntersecting; });
      batch.forEach(function (entry, i) {
        var el = entry.target, parent = el.closest('[data-stagger]');
        var idx = parent ? $all('[data-reveal]', parent).indexOf(el) : i;
        reveal(el, Math.min(idx, 10) * 70);
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    els.forEach(function (e) { io.observe(e); });
  }

  // ---------- parallax ----------
  function setupParallax() {
    if (reduced) return;
    var hero = $('[data-hero]'); if (!hero) return;
    var layers = $all('.layer[data-depth]', hero);
    var mx = 0, my = 0, sy = 0, raf = 0;
    function apply() {
      raf = 0;
      layers.forEach(function (l) {
        var d = parseFloat(l.getAttribute('data-depth'));
        l.style.setProperty('--px', (mx * d * 600).toFixed(1) + 'px');
        l.style.setProperty('--py', (my * d * 600 + sy * d * -1).toFixed(1) + 'px');
      });
    }
    function queue() { if (!raf) raf = requestAnimationFrame(apply); }
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      mx = (e.clientX - r.left) / r.width - 0.5; my = (e.clientY - r.top) / r.height - 0.5; queue();
    });
    hero.addEventListener('pointerleave', function () { mx = 0; my = 0; queue(); });
    win.addEventListener('scroll', function () { sy = Math.min(win.scrollY, 900); queue(); }, { passive: true });
  }

  // ---------- scroll progress ----------
  function setupProgress() {
    var bar = $('#progress'); if (!bar) return;
    var raf = 0;
    function upd() {
      raf = 0;
      var h = doc.documentElement.scrollHeight - win.innerHeight;
      bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, win.scrollY / h) : 0).toFixed(4) + ')';
    }
    win.addEventListener('scroll', function () { if (!raf) raf = requestAnimationFrame(upd); }, { passive: true });
    win.addEventListener('resize', upd);
    upd();
  }

  // ---------- spotlight ----------
  function setupSpotlight() {
    doc.addEventListener('pointermove', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-spot]') : null;
      if (!t) return;
      var r = t.getBoundingClientRect();
      t.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      t.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }, { passive: true });
  }

  win.Deskless = { backoff: backoff, fmtPrice: fmtPrice, fmtUsd: fmtUsd, pickPairs: pickPairs, pickTrending: pickTrending };

  setupSpotlight(); setupProgress(); setupReveal(); setupParallax();
  startBlock(); startPairs();
})();
