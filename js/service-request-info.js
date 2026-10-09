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
    var instrumentField = serviceName === 'Music'
      ? '<label>Instrument or program (optional)<select name="instrument_interest"><option value="">Not sure yet</option>' + ['Piano','Voice','Guitar','Drums','Violin','Music Discovery','Ukulele','Bass','Mandolin','Viola','Cello','Flute','Clarinet','Saxophone','Trumpet'].map(function(name){return '<option>' + name + '</option>';}).join('') + '</select></label>'
      : '<input type="hidden" name="instrument_interest" value="' + escapeHtml(serviceName) + '">';
    return '<form class="service-request-card">' +
      '<p class="service-request-hp" aria-hidden="true"><label>Leave blank<input name="bot-field" tabindex="-1" autocomplete="off"></label></p>' +
      '<fieldset><input type="hidden" name="request_intent" value="booking_help">' +
      '<input type="hidden" name="contact_preference" value="standard">' +
      '<div class="service-request-grid"><label>Your name<input name="parent_name" autocomplete="name" maxlength="160" required></label><label>Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label></div>' +
      '<div class="service-request-grid"><label class="phone-field">Phone number<input name="phone" type="tel" autocomplete="tel" maxlength="40" required></label>' + instrumentField + '</div>' +
      '<div class="service-request-grid"><label>Preferred location (optional)<select name="preferred_location"><option value="">Not sure / flexible</option><option value="CSM Mason">Mason</option><option value="CSM Montgomery">Montgomery</option><option value="CSM Anderson">Anderson</option><option value="CSM Maineville">Maineville</option></select></label><label>Student age (optional)<input name="student_age" type="number" min="2" max="99" inputmode="numeric"></label></div>' +
      '<div class="service-request-grid"><label>Have you taken lessons at CSM before?<select name="existing_family" required><option value="">Please choose</option><option value="no">No, we’re new to CSM</option><option value="yes">Yes, we’re a CSM family</option></select></label><label>Student name (optional)<input name="student_name" maxlength="160"></label></div>' +
      '<label class="service-request-message">How can we help?<textarea name="help_reason" rows="4" maxlength="2000" required></textarea></label>' +
      '<p class="service-request-note reply-note" aria-live="polite">By submitting, you’re asking CSM to contact you by email, phone, or text about lessons. Message and data rates may apply. Reply STOP to stop texts. Sending this form does not book a lesson.</p></fieldset>' +
      '<button class="service-request-submit" type="submit">Request Information</button><div class="service-request-error" role="alert"></div></form>' +
      '<div class="service-request-success" tabindex="-1" hidden><h3>Your request reached our office.</h3><p></p></div>';
  }

  function mount(root){
    var mountPoint = root.querySelector('.service-request-mount');
    if(!mountPoint || mountPoint.dataset.ready === '1') return;
    mountPoint.dataset.ready = '1';
    var serviceName = trim(root.getAttribute('data-service-name'),100) || 'Music';
    mountPoint.innerHTML = formMarkup(serviceName);
    var form = mountPoint.querySelector('form');
    var success = mountPoint.querySelector('.service-request-success');
    var errorBox = form.querySelector('.service-request-error');
    var submit = form.querySelector('.service-request-submit');
    var preference = form.elements.contact_preference;
    var phone = form.elements.phone;
    var params = new URLSearchParams(location.search);
    var submissionId = 'inquiry-' + uniqueId();
    var pendingPayload = null;
    var busy = false;
    if(params.get('existing_family') === 'yes') form.elements.existing_family.value = 'yes';
    if(LOCATION_LABELS[params.get('location')]) form.elements.preferred_location.value = LOCATION_LABELS[params.get('location')];
    var names = {'music-discovery':'Music Discovery',drums:'Drums',piano:'Piano',voice:'Voice',guitar:'Guitar',violin:'Violin'};
    if(serviceName === 'Music' && names[params.get('service')]) form.elements.instrument_interest.value = names[params.get('service')];
    function sync(){
      form.querySelector('.reply-note').textContent = 'By submitting, you’re asking CSM to contact you by email, phone, or text about lessons. Message and data rates may apply. Reply STOP to stop texts. Sending this form does not book a lesson.';
      submit.textContent = 'Request Information';
    }
    phone.addEventListener('input',function(){phone.setCustomValidity('');});sync();
    form.addEventListener('submit',function(event){
      event.preventDefault(); if(busy) return; errorBox.textContent = '';
      if(!pendingPayload){
        var digits = phone.value.replace(/\D/g,'');
        phone.setCustomValidity(phone.disabled || (digits.length === 10 || (digits.length === 11 && digits[0] === '1')) ? '' : 'Enter a 10-digit phone number.');
        if(!form.reportValidity()) return;
        var data = Object.fromEntries(new FormData(form));
        pendingPayload = Object.assign({},currentAttribution(),data,{
          'form-name':'lesson-fit-request',inquiry_version:'20261009-standard',client_submission_id:submissionId,
          submitted_at:nowIso(),phone:phone.value,
          lesson_request:data.instrument_interest ? data.instrument_interest + ' lessons' : 'Music lessons',
          routing_outcome:'explicit-inquiry',student_context:'Website inquiry from ' + location.pathname
        });
      }
      busy = true;submit.disabled = true;submit.textContent = 'Sending…';form.querySelector('fieldset').disabled = true;
      var controller = new AbortController();var timeout = setTimeout(function(){controller.abort();},25000);
      fetch('/api/lesson-fit-submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pendingPayload),signal:controller.signal})
      .then(function(response){return response.json().catch(function(){return {};}).then(function(body){
        if(!response.ok || !body.ok || body.office_email_confirmed !== true){
          if(response.status === 422 || response.status === 400){pendingPayload = null;form.querySelector('fieldset').disabled = false;}
          throw new Error(body.error || 'Delivery is not confirmed.');
        }
        return body;
      });}).then(function(result){
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({event:pendingPayload.request_intent === 'booking_help' ? 'lesson_fit_help_submit' : 'csm_question_submit',request_intent:pendingPayload.request_intent,contact_preference:pendingPayload.contact_preference,instrument_interest:pendingPayload.instrument_interest,preferred_location:pendingPayload.preferred_location,csm_lead_id:result.lead_id || ''});
        if(pendingPayload.request_intent === 'booking_help' && typeof window.fbq === 'function') window.fbq('track','Lead',{content_name:'Request Information'});
        form.hidden = true;success.hidden = false;
        success.querySelector('p').textContent = 'Our office will follow up by email, phone, or text about your request. No lesson has been booked.';
        success.focus();
      }).catch(function(){
        errorBox.textContent = 'We could not confirm delivery. Your answers are still here. Retry this request, or email info@cincinnatischoolofmusic.com. Retrying will not create a duplicate inquiry.';
        submit.disabled = false;submit.textContent = 'Retry Sending';
      }).finally(function(){clearTimeout(timeout);busy=false;});
    });
  }
  captureAttribution();decorateBookingLinks();
  function init(){document.querySelectorAll(ROOT_SELECTOR).forEach(mount);decorateBookingLinks();}
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
