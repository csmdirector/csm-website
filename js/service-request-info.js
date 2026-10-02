(function(){
  'use strict';

  var ROOT_SELECTOR = '[data-csm-service-request]';
  var TRACKING_KEYS = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','gbraid','wbraid'];
  var CLICK_ID_KEYS = ['gclid','gbraid','wbraid'];
  var STORAGE_KEY = 'csmAttribution';
  var LEGACY_KEY = 'csmLessonFitAttribution';
  var TTL_MS = 90 * 24 * 60 * 60 * 1000;
  var LOCATION_LABELS = {
    mason: 'CSM Mason',
    montgomery: 'CSM Montgomery',
    anderson: 'CSM Anderson',
    maineville: 'CSM Maineville'
  };

  function trim(value, max){
    return String(value == null ? '' : value).trim().slice(0, max || 500);
  }

  function readJson(key){
    try { return JSON.parse(window.localStorage.getItem(key) || '{}') || {}; }
    catch (_) { return {}; }
  }

  function writeJson(key, value){
    try { window.localStorage.setItem(key, JSON.stringify(value)); }
    catch (_) {}
  }

  function nowIso(){ return new Date().toISOString(); }

  function trackingSnapshot(){
    var params = new URLSearchParams(window.location.search);
    var out = {};
    TRACKING_KEYS.forEach(function(key){
      var value = trim(params.get(key));
      if(value) out[key] = value;
    });
    return out;
  }

  function hasTracking(value){
    return TRACKING_KEYS.some(function(key){ return Boolean(value && value[key]); });
  }

  function isPaid(value){
    if(CLICK_ID_KEYS.some(function(key){ return Boolean(value && value[key]); })) return true;
    return /^(cpc|ppc|paid|paid[-_ ]?search|sem)$/i.test((value && value.utm_medium) || '');
  }

  function safeLandingPath(){
    var params = new URLSearchParams();
    var current = new URLSearchParams(window.location.search);
    TRACKING_KEYS.forEach(function(key){
      var value = trim(current.get(key));
      if(value) params.set(key, value);
    });
    return window.location.pathname + (params.toString() ? '?' + params.toString() : '');
  }

  function captureAttribution(){
    var snapshot = trackingSnapshot();
    var stored = readJson(STORAGE_KEY);
    var timestamp = nowIso();
    if(stored.expires_at && Date.parse(stored.expires_at) <= Date.now()) stored = {};

    var landingPath = safeLandingPath();
    var referrer = '';
    try {
      if(document.referrer){
        var r = new URL(document.referrer);
        referrer = r.origin + r.pathname;
      }
    } catch (_) {}

    function touch(){
      var t = {
        timestamp: timestamp,
        referrer: referrer,
        first_landing_path: landingPath,
        latest_landing_path: landingPath,
        source_type: hasTracking(snapshot) ? 'campaign' : 'direct'
      };
      TRACKING_KEYS.forEach(function(key){ t[key] = snapshot[key] || ''; });
      return t;
    }

    if(!stored.first_touch){
      stored.first_touch = touch();
      stored.latest_touch = stored.first_touch;
      stored.created_at = timestamp;
    } else if(hasTracking(snapshot)){
      var latest = touch();
      latest.first_landing_path = stored.first_touch.first_landing_path || landingPath;
      stored.latest_touch = latest;
    }

    if(isPaid(snapshot)) stored.last_paid_click_timestamp = timestamp;
    stored.version = 2;
    stored.ttl_days = 90;
    stored.updated_at = timestamp;
    stored.expires_at = new Date(Date.now() + TTL_MS).toISOString();
    writeJson(STORAGE_KEY, stored);

    var first = stored.first_touch || {};
    var latest = stored.latest_touch || first;
    var flat = {};
    TRACKING_KEYS.forEach(function(key){ flat[key] = latest[key] || ''; });
    flat.first_landing_path = first.first_landing_path || first.latest_landing_path || '';
    flat.latest_landing_path = latest.latest_landing_path || latest.first_landing_path || flat.first_landing_path || '';
    flat.landing_path = flat.latest_landing_path;
    flat.referrer = latest.referrer || first.referrer || '';
    flat.timestamp = latest.timestamp || stored.updated_at || '';
    flat.attribution_timestamp = flat.timestamp;
    flat.last_paid_click_timestamp = stored.last_paid_click_timestamp || '';
    flat.source_type = latest.source_type || '';

    if(hasTracking(flat)) writeJson(LEGACY_KEY, flat);

    window.CSMAttribution = window.CSMAttribution || {};
    if(typeof window.CSMAttribution.getLatest !== 'function'){
      window.CSMAttribution.getLatest = function(){ return Object.assign({}, flat); };
    }
    return flat;
  }

  function currentAttribution(){
    var params = trackingSnapshot();
    var stored = readJson(STORAGE_KEY);
    var first = stored.first_touch || {};
    var latest = stored.latest_touch || first;
    var legacy = readJson(LEGACY_KEY);
    var out = {};
    TRACKING_KEYS.forEach(function(key){
      out[key] = params[key] || latest[key] || legacy[key] || '';
    });
    out.first_landing_path = first.first_landing_path || legacy.first_landing_path || '';
    out.latest_landing_path = latest.latest_landing_path || legacy.latest_landing_path || safeLandingPath();
    out.landing_path = out.latest_landing_path;
    out.referrer = latest.referrer || legacy.referrer || '';
    out.attribution_timestamp = latest.timestamp || legacy.attribution_timestamp || legacy.timestamp || '';
    out.last_paid_click_timestamp = stored.last_paid_click_timestamp || legacy.last_paid_click_timestamp || '';
    out.source_type = latest.source_type || legacy.source_type || (hasTracking(out) ? 'campaign' : 'direct');
    return out;
  }

  function decorateBookingLinks(){
    var attribution = currentAttribution();
    var selector = 'a[href^="/book-intro/"],a[href^="/book-piano-intro/"]';
    document.querySelectorAll(selector).forEach(function(link){
      try {
        var url = new URL(link.getAttribute('href'), window.location.origin);
        TRACKING_KEYS.forEach(function(key){
          if(attribution[key] && !url.searchParams.has(key)) url.searchParams.set(key, attribution[key]);
        });
        if(attribution.first_landing_path && !url.searchParams.has('first_landing_path')) url.searchParams.set('first_landing_path', attribution.first_landing_path);
        if(attribution.latest_landing_path && !url.searchParams.has('latest_landing_path')) url.searchParams.set('latest_landing_path', attribution.latest_landing_path);
        if(attribution.last_paid_click_timestamp && !url.searchParams.has('last_paid_click_timestamp')) url.searchParams.set('last_paid_click_timestamp', attribution.last_paid_click_timestamp);
        link.href = url.pathname + url.search;
      } catch (_) {}
    });
  }

  function uniqueId(){
    if(window.crypto && typeof window.crypto.randomUUID === 'function'){
      return window.crypto.randomUUID().replace(/-/g,'');
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function escapeHtml(value){
    return trim(value, 160).replace(/[&<>"']/g,function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }

  function formMarkup(serviceName){
    return '' +
      '<form class="service-request-card" novalidate>' +
        '<input type="hidden" name="form-name" value="lesson-fit-request">' +
        '<input type="hidden" name="instrument_interest" value="' + escapeHtml(serviceName) + '">' +
        '<p class="service-request-hp" aria-hidden="true"><label>Leave blank<input name="bot-field" tabindex="-1" autocomplete="off"></label></p>' +
        '<fieldset>' +
          '<div class="service-request-grid">' +
            '<label>Your name<input name="parent_name" autocomplete="name" maxlength="160" required></label>' +
            '<label>Student name<input name="student_name" maxlength="160" required></label>' +
          '</div>' +
          '<div class="service-request-grid">' +
            '<label>Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label>' +
            '<label>Mobile phone<input name="phone" type="tel" autocomplete="tel" maxlength="40" required></label>' +
          '</div>' +
          '<div class="service-request-grid">' +
            '<label>Student age<input name="student_age" type="number" inputmode="numeric" min="2" max="99" required></label>' +
            '<label>Preferred location<select name="preferred_location" required>' +
              '<option value="">Choose a location</option>' +
              '<option value="CSM Mason">Mason</option>' +
              '<option value="CSM Montgomery">Montgomery</option>' +
              '<option value="CSM Anderson">Anderson</option>' +
              '<option value="CSM Maineville">Maineville</option>' +
            '</select></label>' +
          '</div>' +
          '<fieldset class="service-request-family">' +
            '<legend>Have you taken lessons at CSM before?</legend>' +
            '<div class="service-request-options">' +
              '<label><input type="radio" name="existing_family" value="no" required> No, we’re new to CSM</label>' +
              '<label><input type="radio" name="existing_family" value="yes" required> Yes, we’re a CSM family</label>' +
            '</div>' +
          '</fieldset>' +
        '</fieldset>' +
        '<button class="service-request-submit" type="submit">Have CSM Help Me Find a Time</button>' +
        '<div class="service-request-error" role="alert"></div>' +
        '<p class="service-request-note">This sends your request to the CSM office. It does not reserve or charge for a lesson.</p>' +
      '</form>' +
      '<div class="service-request-success" tabindex="-1" hidden>' +
        '<h3>We’ll help you from here.</h3>' +
        '<p>Your request is saved. The CSM office will contact you about a teacher and time.</p>' +
      '</div>';
  }

  function buildPayload(form, serviceName, serviceSlug){
    var data = new FormData(form);
    var attribution = currentAttribution();
    var payload = {
      'form-name': 'lesson-fit-request',
      client_submission_id: 'known-intent-' + uniqueId(),
      submitted_at: nowIso(),
      parent_name: trim(data.get('parent_name'),160),
      student_name: trim(data.get('student_name'),160),
      email: trim(data.get('email'),254),
      phone: trim(data.get('phone'),40),
      student_age: trim(data.get('student_age'),40),
      instrument_interest: serviceName,
      preferred_location: trim(data.get('preferred_location'),100),
      existing_family: trim(data.get('existing_family'),20),
      help_reason: 'Please help me find the right ' + serviceName + ' teacher and intro time.',
      lesson_request: serviceName + ' lessons',
      routing_outcome: 'known-intent-service-page',
      student_context: 'Known-intent request from ' + window.location.pathname + ' (' + serviceSlug + ').'
    };
    Object.keys(attribution).forEach(function(key){
      if(attribution[key]) payload[key] = attribution[key];
    });
    return payload;
  }

  function pushLeadEvent(payload, result){
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'lesson_fit_help_submit',
        routing_outcome: 'known-intent-service-page',
        instrument_interest: payload.instrument_interest,
        preferred_location: payload.preferred_location,
        csm_lead_id: result && result.lead_id ? result.lead_id : '',
        utm_source: payload.utm_source || '',
        utm_medium: payload.utm_medium || '',
        utm_campaign: payload.utm_campaign || '',
        utm_content: payload.utm_content || '',
        utm_term: payload.utm_term || '',
        gclid: payload.gclid || '',
        gbraid: payload.gbraid || '',
        wbraid: payload.wbraid || '',
        click_id: payload.gclid || payload.gbraid || payload.wbraid || '',
        landing_path: payload.landing_path || payload.latest_landing_path || window.location.pathname,
        first_landing_path: payload.first_landing_path || '',
        latest_landing_path: payload.latest_landing_path || payload.landing_path || window.location.pathname,
        attribution_timestamp: payload.attribution_timestamp || ''
      });
      if(typeof window.fbq === 'function'){
        window.fbq('track','Lead',{content_name: payload.instrument_interest + ' Request Info',content_category:'Known Intent'});
      }
    } catch (_) {}
  }

  function mount(root){
    var mountPoint = root.querySelector('.service-request-mount');
    if(!mountPoint || mountPoint.dataset.ready === '1') return;
    mountPoint.dataset.ready = '1';
    var serviceName = trim(root.getAttribute('data-service-name'),100) || 'Music';
    var serviceSlug = trim(root.getAttribute('data-service-slug'),80) || 'music';
    mountPoint.innerHTML = formMarkup(serviceName);

    var form = mountPoint.querySelector('form');
    var success = mountPoint.querySelector('.service-request-success');
    var errorBox = mountPoint.querySelector('.service-request-error');
    var submit = mountPoint.querySelector('.service-request-submit');

    form.addEventListener('submit', function(event){
      event.preventDefault();
      errorBox.textContent = '';
      if(!form.reportValidity()) return;
      var payload = buildPayload(form, serviceName, serviceSlug);
      submit.disabled = true;
      submit.textContent = 'Sending…';

      fetch('/api/lesson-fit-submit',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      }).then(function(response){
        return response.json().catch(function(){ return {}; }).then(function(body){
          if(!response.ok || !body.ok) throw new Error(body.error || 'Request not confirmed.');
          return body;
        });
      }).then(function(result){
        pushLeadEvent(payload,result);
        form.hidden = true;
        success.hidden = false;
        success.focus();
      }).catch(function(){
        errorBox.textContent = 'We could not confirm your request. Please try again, or call or text (513) 560-9175.';
        submit.disabled = false;
        submit.textContent = 'Have CSM Help Me Find a Time';
      });
    });
  }

  captureAttribution();
  decorateBookingLinks();

  function init(){
    document.querySelectorAll(ROOT_SELECTOR).forEach(mount);
    decorateBookingLinks();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();