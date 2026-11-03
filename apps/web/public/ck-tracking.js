/* CupKey app (app.cupkey.io): consent banner + Consent Mode v2 + pixels + attribution.
   Mirrors the cupkey.io marketing snippet (v1 2026-10-28). Consent and attribution cookies are
   set on .cupkey.io, so a choice made on the marketing site carries over and the banner does not
   show twice. Exposes window.ckTrack(event, params) and window.ckIdentify(userId) for the app. */
(function () {
  if (window.__ckTracking) return;
  window.__ckTracking = 1;

  var DOMAIN = /(^|\.)cupkey\.io$/.test(location.hostname) ? '.cupkey.io' : location.hostname;
  var IDS = { ga4: 'GT-5R6BFL84', google: 'GT-PZZP7CCT', googleAds: 'AW-18542142375', meta: '1431789329136523', linkedin: '10261724', x: 'ri435', tiktok: '' };
  /* Per-platform signup conversion IDs. Fill these in once the conversions are created in each ad platform.
     Empty = that platform's signup conversion is skipped (GA4 sign_up and Meta CompleteRegistration always fire). */
  var SIGNUP = window.CK_SIGNUP_IDS || { googleAdsLabel: '', linkedinConversionId: '', xEventId: '' };
  var KEYS = ['gclid','gbraid','wbraid','fbclid','li_fat_id','twclid','ttclid','msclkid','utm_source','utm_medium','utm_campaign','utm_content','utm_term','utm_id'];

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { dataLayer.push(arguments); };

  function setCookie(n, v, days) { document.cookie = n + '=' + encodeURIComponent(v) + ';domain=' + DOMAIN + ';path=/;max-age=' + (days * 86400) + ';SameSite=Lax' + (location.protocol === 'https:' ? ';Secure' : ''); }
  function getCookie(n) { var m = document.cookie.match('(?:^|; )' + n + '=([^;]*)'); return m ? decodeURIComponent(m[1]) : null; }
  function readJSON(n) { try { return JSON.parse(getCookie(n)); } catch (e) { return null; } }

  /* ---------- attribution (keeps first touch from cupkey.io) ---------- */
  function thisTouch() {
    var p = new URLSearchParams(location.search), t = {}, hasIds = false;
    KEYS.forEach(function (k) { var v = p.get(k); if (v) { t[k] = v.slice(0, 200); hasIds = true; } });
    var ref = document.referrer || '', external = false;
    try { external = ref && !/(^|\.)cupkey\.io$/.test(new URL(ref).hostname) && !/accounts\.google\.com$/.test(new URL(ref).hostname); } catch (e) {}
    if (!hasIds && !external) return null;
    t.landing_page = (location.origin + location.pathname).slice(0, 300);
    t.referrer = external ? ref.slice(0, 300) : '';
    t.ts = Date.now();
    return t;
  }
  var pending = thisTouch();
  function saveAttribution() {
    if (!pending) return; /* app visits without a new source never overwrite marketing attribution */
    var cur = readJSON('ck_attr') || {};
    if (!cur.first) cur.first = pending;
    cur.last = pending;
    setCookie('ck_attr', JSON.stringify(cur), 90);
    pending = null;
  }

  /* ---------- pixels ---------- */
  function loadScript(src) { var s = document.createElement('script'); s.async = true; s.src = src; document.head.appendChild(s); }
  var loaded = {}, consent = null, userId = null;

  function loadGA4() {
    if (loaded.ga4) return;
    loaded.ga4 = 1;
    loadScript('https://www.googletagmanager.com/gtag/js?id=' + IDS.ga4);
    if (!loaded.google) gtag('js', new Date());
    gtag('config', IDS.ga4, { cookie_domain: 'auto', user_id: userId || undefined });
  }
  function loadPixels(c) {
    consent = c;
    gtag('consent', 'update', {
      analytics_storage: c.analytics ? 'granted' : 'denied',
      ad_storage: c.marketing ? 'granted' : 'denied',
      ad_user_data: c.marketing ? 'granted' : 'denied',
      ad_personalization: c.marketing ? 'granted' : 'denied'
    });
    if ((c.analytics || c.marketing) && !loaded.google) {
      loaded.google = 1;
      loadScript('https://www.googletagmanager.com/gtag/js?id=' + IDS.google);
      if (!loaded.ga4) gtag('js', new Date());
      gtag('config', IDS.google, { cookie_domain: 'auto' });
      gtag('config', IDS.googleAds, { cookie_domain: 'auto' });
    }
    if (!c.marketing) return;
    if (!loaded.meta) {
      loaded.meta = 1;
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', IDS.meta);
      fbq('track', 'PageView');
    }
    if (!loaded.linkedin) {
      loaded.linkedin = 1;
      window._linkedin_partner_id = IDS.linkedin;
      window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
      window._linkedin_data_partner_ids.push(IDS.linkedin);
      (function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}})(window.lintrk);
      loadScript('https://snap.licdn.com/li.lms-analytics/insight.min.js');
    }
    if (!loaded.x) {
      loaded.x = 1;
      !function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments)},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
      twq('config', IDS.x);
    }
    if (IDS.tiktok && !loaded.tiktok) {
      loaded.tiktok = 1;
      !function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=['page','track','identify','instances','debug','on','off','once','ready','alias','group','enableCookie','disableCookie'];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var n='https://analytics.tiktok.com/i18n/pixel/events.js';ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=n;ttq._t=ttq._t||{};ttq._t[e]=+new Date;var s=d.createElement('script');s.type='text/javascript';s.async=!0;s.src=n+'?sdkid='+e+'&lib='+t;var a=d.getElementsByTagName('script')[0];a.parentNode.insertBefore(s,a)};ttq.load(IDS.tiktok);ttq.page();}(window,document,'ttq');
    }
  }

  /* ---------- app API ---------- */
  /* SPA page views: GA4 enhanced measurement picks up history changes on its own; Meta needs a nudge. */
  var lastPath = location.pathname;
  window.ckPageView = function () {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    if (window.fbq && loaded.meta) fbq('track', 'PageView');
  };
  window.ckIdentify = function (id) {
    if (!id || id === userId) return;
    userId = String(id);
    gtag('set', { user_id: userId });
  };
  window.ckTrack = function (name, params) {
    params = params || {};
    gtag('event', name, params); /* GA4 (respects analytics consent via Consent Mode) */
    if (name !== 'sign_up') return;
    var a = readJSON('ck_attr') || {};
    var src = (a.first && (a.first.utm_source || a.first.referrer)) || 'direct';
    if (SIGNUP.googleAdsLabel) gtag('event', 'conversion', { send_to: IDS.googleAds + '/' + SIGNUP.googleAdsLabel });
    if (!consent || !consent.marketing) return;
    if (window.fbq) fbq('track', 'CompleteRegistration', { method: params.method, first_source: src });
    if (window.lintrk && SIGNUP.linkedinConversionId) lintrk('track', { conversion_id: SIGNUP.linkedinConversionId });
    if (window.twq && SIGNUP.xEventId) twq('event', SIGNUP.xEventId, {});
    if (window.ttq && IDS.tiktok) ttq.track('CompleteRegistration');
  };

  /* ---------- banner (same design as cupkey.io) ---------- */
  var css = '#ck-banner{position:fixed;left:24px;bottom:24px;z-index:2147483000;width:400px;max-width:calc(100vw - 48px);background:#fff;border:2px solid #201e1d;box-shadow:8px 8px 0 #201e1d;padding:24px;box-sizing:border-box;font-family:Archivo,system-ui,-apple-system,"Segoe UI",sans-serif;color:#201e1d;display:none;text-align:left}' +
    '#ck-banner.ck-open{display:block}#ck-banner *{box-sizing:border-box}' +
    '#ck-banner .ck-top{display:flex;align-items:center;gap:12px;margin:0 0 16px}' +
    '#ck-banner .ck-eyebrow{margin:0;font-size:12px;font-weight:800;letter-spacing:.14em;color:#c8260d}' +
    '#ck-banner h2{margin:0 0 16px;font-size:26px;line-height:1.1;font-weight:800;letter-spacing:-.01em;color:#201e1d}' +
    '#ck-banner p.ck-body{margin:0 0 16px;font-size:15px;line-height:1.5;color:#3a3634}' +
    '#ck-banner .ck-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}' +
    '#ck-banner .ck-btn{height:48px;font-family:inherit;font-size:15px;font-weight:800;cursor:pointer;border-radius:0;margin:0;padding:0 12px}' +
    '#ck-banner .ck-primary{background:linear-gradient(120deg,#ff3d17,#ff8a3c);color:#201e1d;border:0}' +
    '#ck-banner .ck-secondary{background:#fff;color:#201e1d;border:2px solid #201e1d}' +
    '#ck-banner .ck-links{display:flex;justify-content:space-between;align-items:center;min-height:44px;margin-top:8px}' +
    '#ck-banner .ck-link{background:none;border:0;padding:0;font-family:inherit;font-size:14px;font-weight:800;color:#201e1d;text-decoration:underline;text-underline-offset:3px;cursor:pointer}' +
    '#ck-banner a.ck-policy{font-size:14px;font-weight:600;color:#625d5a}' +
    '#ck-banner .ck-link:hover,#ck-banner a.ck-policy:hover{color:#c8260d}' +
    '#ck-banner button:focus-visible,#ck-banner input:focus-visible,#ck-banner a:focus-visible{outline:3px solid #c8260d;outline-offset:2px}' +
    '#ck-banner .ck-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px}' +
    '#ck-banner .ck-head h2{margin:8px 0 0;font-size:24px}' +
    '#ck-banner .ck-back{width:44px;height:44px;background:none;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}' +
    '#ck-banner .ck-list{border-top:2px solid #201e1d;margin-bottom:16px}' +
    '#ck-banner label.ck-item{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;padding:16px 0;border-bottom:1px solid #e2dfdd;cursor:pointer}' +
    '#ck-banner .ck-item-name{display:block;font-size:16px;font-weight:800}' +
    '#ck-banner .ck-item-name small{font-size:12px;font-weight:600;color:#625d5a}' +
    '#ck-banner .ck-item-desc{display:block;font-size:14px;line-height:1.45;color:#3a3634;margin-top:4px}' +
    '#ck-banner input.ck-sw{appearance:none;-webkit-appearance:none;width:46px;height:26px;border:2px solid #201e1d;background:#fff;position:relative;cursor:pointer;margin:0;flex-shrink:0;border-radius:0}' +
    '#ck-banner input.ck-sw::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;background:#201e1d;transition:left .15s ease}' +
    '#ck-banner input.ck-sw:checked{background:#201e1d}#ck-banner input.ck-sw:checked::after{left:23px;background:#fff}' +
    '#ck-banner input.ck-sw:disabled{opacity:.5;cursor:not-allowed}#ck-banner [hidden]{display:none!important}' +
    '@media (max-width:640px){#ck-banner{left:0;right:0;bottom:0;width:100%;max-width:100%;border:0;border-top:2px solid #201e1d;box-shadow:0 -8px 0 rgba(32,30,29,.08);padding:20px 20px 28px;max-height:86vh;overflow-y:auto}#ck-banner h2{font-size:24px}#ck-banner .ck-row{grid-template-columns:1fr}#ck-banner .ck-btn{height:50px;font-size:16px}}';

  var cup = '<svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#201e1d" stroke-width="2" stroke-linecap="square"><path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9z"/><path d="M16 11h2a2 2 0 0 1 0 4h-2"/><path d="M8 3v3"/><path d="M12 3v3"/></svg>';
  var html =
    '<div class="ck-view" data-view="main">' +
      '<div class="ck-top">' + cup + '<p class="ck-eyebrow">BEFORE YOU POUR</p></div>' +
      '<h2>A cookie with your cup?</h2>' +
      '<p class="ck-body">We use cookies to keep Cupkey running and to learn which videos and posts brought you here. We never sell your data. Change your mind anytime.</p>' +
      '<div class="ck-row"><button type="button" class="ck-btn ck-primary" data-ck="all">Sounds good</button><button type="button" class="ck-btn ck-secondary" data-ck="none">Only essentials</button></div>' +
      '<div class="ck-links"><button type="button" class="ck-link" data-ck="prefs">Choose what’s in my cup →</button><a class="ck-policy" href="https://cupkey.io/privacy-policy/" target="_blank" rel="noopener">Cookie policy</a></div>' +
    '</div>' +
    '<div class="ck-view" data-view="prefs" hidden>' +
      '<div class="ck-head"><div><p class="ck-eyebrow">YOUR CUP, YOUR CALL</p><h2>What goes in your cup</h2></div>' +
      '<button type="button" class="ck-back" data-ck="back" aria-label="Back"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#201e1d" stroke-width="2.5"><path d="M15 6l-6 6 6 6"/></svg></button></div>' +
      '<div class="ck-list">' +
        '<label class="ck-item"><span><span class="ck-item-name">Essentials <small>· always on</small></span><span class="ck-item-desc">Logins, security, and remembering this choice. The site breaks without these.</span></span><input class="ck-sw" type="checkbox" checked disabled aria-label="Essential cookies, always on"></label>' +
        '<label class="ck-item"><span><span class="ck-item-name">Analytics</span><span class="ck-item-desc">Which pages help and which ones bore you. Counts, not names.</span></span><input class="ck-sw" type="checkbox" id="ck-analytics" aria-label="Analytics cookies"></label>' +
        '<label class="ck-item"><span><span class="ck-item-name">Marketing</span><span class="ck-item-desc">Lets us show you Cupkey on YouTube, LinkedIn, X, Meta and TikTok instead of someone else’s ad.</span></span><input class="ck-sw" type="checkbox" id="ck-marketing" aria-label="Marketing cookies"></label>' +
      '</div>' +
      '<div class="ck-row"><button type="button" class="ck-btn ck-secondary" data-ck="save">Save my choice</button><button type="button" class="ck-btn ck-primary" data-ck="all">Accept all</button></div>' +
    '</div>';

  var box;
  function show(view) { box.querySelectorAll('.ck-view').forEach(function (v) { v.hidden = v.getAttribute('data-view') !== view; }); }
  function build() {
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    box = document.createElement('section');
    box.id = 'ck-banner';
    box.setAttribute('aria-label', 'Cookie preferences');
    box.innerHTML = html;
    document.body.appendChild(box);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ck]'); if (!b) return;
      var k = b.getAttribute('data-ck');
      if (k === 'all') decide(true, true);
      else if (k === 'none') decide(false, false);
      else if (k === 'prefs') show('prefs');
      else if (k === 'back') show('main');
      else if (k === 'save') decide(box.querySelector('#ck-analytics').checked, box.querySelector('#ck-marketing').checked);
    });
  }
  function openBanner(toPrefs) {
    if (!box) build();
    var c = readJSON('ck_consent');
    box.querySelector('#ck-analytics').checked = c ? !!c.analytics : true;
    box.querySelector('#ck-marketing').checked = !!(c && c.marketing);
    show(toPrefs ? 'prefs' : 'main');
    box.classList.add('ck-open');
  }
  function decide(analytics, marketing) {
    var c = { analytics: analytics, marketing: marketing, ts: Date.now(), v: 1 };
    setCookie('ck_consent', JSON.stringify(c), 365);
    box.classList.remove('ck-open');
    if (analytics || marketing) saveAttribution();
    loadPixels(c);
  }
  window.ckOpenConsent = function () { openBanner(true); };
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href="#cookie-settings"]');
    if (a) { e.preventDefault(); openBanner(true); }
  }, true);

  function init() {
    var c = readJSON('ck_consent');
    if (c && c.v === 1) {
      if (c.analytics || c.marketing) saveAttribution();
      loadPixels(c);
    } else {
      openBanner(false);
    }
    loadGA4();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
