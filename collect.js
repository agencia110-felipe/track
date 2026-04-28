import { db } from '../db.js';
import { randomUUID } from '../utils.js';
import { createHash } from 'crypto';

export async function collectRoute(fastify) {
  fastify.post('/collect', async (req, reply) => {
    try {
      const body = req.body || {};
      const clientId = body.client_id;
      if (!clientId) return reply.code(400).send({ error: 'invalid_request' });

      const ip = req.headers['cf-connecting-ip'] ||
                 (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
                 req.ip || '';
      const ua = req.headers['user-agent'] || '';

      const { isBot } = detectBot(ua);

      // Credenciais do cliente
      const platforms = await db.query(
        `SELECT platform, pixel_id, access_token, test_event_code,
                measurement_id, api_secret, conversion_id, conversion_label
         FROM client_platforms WHERE client_id = $1 AND enabled = TRUE`,
        [clientId]
      );
      const creds = {};
      platforms.forEach(p => { creds[p.platform] = p; });

      const eventName = body.event_name || 'Lead';
      const eventId   = body.event_id   || randomUUID();
      const eventTime = body.event_time || Math.floor(Date.now() / 1000);
      const sourceUrl = body.event_source_url || '';
      const sessionId = body.session_id || '';
      const pageId    = body.page_id || null;
      const ud        = body.user_data || {};
      const cd        = body.custom_data || {};
      const utm       = body.utm || {};

      // Sessão
      let sessionData = {};
      if (sessionId) {
        sessionData = await db.queryOne(
          'SELECT * FROM sessions WHERE session_id = $1 AND client_id = $2',
          [sessionId, clientId]
        ) || {};
      }

      // Resolução fbp/fbc com fallback
      const fbp = validateFbCookie(ud.fbp) || validateFbCookie(sessionData.fbp) || '';
      const fbc = validateFbCookie(sessionData.fbc) || validateFbCookie(ud.fbc) || '';
      const gclid = body.gclid || sessionData.gclid || '';
      const externalId = ud.external_id || sessionData.external_id || randomUUID();
      const gaClientId = ud.ga_client_id || sessionData.ga_client_id ||
                         `${Date.now()}.${Math.floor(Math.random() * 1e9)}`;

      const pixelWasBlocked = !ud.fbp && !ud.fbc;
      const fbpSource = ud.fbp ? 'pixel_js' : (sessionData.fbp ? 'server' : 'none');

      // Upsert sessão
      if (sessionId) {
        await db.run(
          `INSERT INTO sessions (session_id, client_id, external_id, fbclid, gclid, msclkid,
             fbc, fbp, ip_address, user_agent, referrer, landing_url,
             utm_source, utm_medium, utm_campaign, utm_content, utm_term,
             created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
           ON CONFLICT (session_id, client_id) DO UPDATE SET
             fbc = COALESCE(NULLIF(EXCLUDED.fbc,''), sessions.fbc),
             fbp = COALESCE(NULLIF(EXCLUDED.fbp,''), sessions.fbp),
             gclid = COALESCE(NULLIF(EXCLUDED.gclid,''), sessions.gclid),
             updated_at = EXCLUDED.updated_at`,
          [sessionId, clientId, externalId,
           body.fbclid||'', gclid, body.msclkid||'',
           fbc, fbp, ip, ua, ud.referrer||'', sourceUrl,
           utm.source||'', utm.medium||'', utm.campaign||'',
           utm.content||'', utm.term||'', Date.now(), Date.now()]
        ).catch(() => {});
      }

      // PII → hash SHA-256
      const rawEmail   = (ud.em  || '').toLowerCase().trim();
      const rawFirst   = normalizeName(ud.fn || '');
      const rawLast    = normalizeName(ud.ln || '');
      const rawPhone   = normalizePhone(ud.ph || '');
      const rawCity    = (ud.ct  || '').toLowerCase().trim();
      const rawState   = (ud.st  || '').toLowerCase().trim();
      const rawZip     = (ud.zp  || '').replace(/\D/g, '');
      const rawCountry = (ud.country || 'br').toLowerCase().trim();

      const [hashedEm, hashedFn, hashedLn, hashedPh, hashedEid,
             hashedCt, hashedSt, hashedZp] = await Promise.all([
        rawEmail   ? sha256(rawEmail)   : Promise.resolve(''),
        rawFirst   ? sha256(rawFirst)   : Promise.resolve(''),
        rawLast    ? sha256(rawLast)    : Promise.resolve(''),
        rawPhone   ? sha256(rawPhone)   : Promise.resolve(''),
        externalId ? sha256(externalId) : Promise.resolve(''),
        rawCity    ? sha256(rawCity)    : Promise.resolve(''),
        rawState   ? sha256(rawState)   : Promise.resolve(''),
        rawZip     ? sha256(rawZip)     : Promise.resolve(''),
      ]);

      // user_data para Meta CAPI
      // Referência: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
      const metaUserData = { client_ip_address: ip, client_user_agent: ua };
      if (hashedEm)  metaUserData.em          = [hashedEm];
      if (hashedFn)  metaUserData.fn          = [hashedFn];
      if (hashedLn)  metaUserData.ln          = [hashedLn];
      if (hashedPh)  metaUserData.ph          = [hashedPh];
      if (hashedEid) metaUserData.external_id = [hashedEid];
      if (hashedCt)  metaUserData.ct          = [hashedCt];
      if (hashedSt)  metaUserData.st          = [hashedSt];
      if (hashedZp)  metaUserData.zp          = [hashedZp];
      if (rawCountry) metaUserData.country    = [rawCountry];
      if (fbp)       metaUserData.fbp         = fbp;
      if (fbc)       metaUserData.fbc         = fbc;

      const results = {};

      if (!isBot) {
        // META CAPI
        if (creds.meta?.pixel_id && creds.meta?.access_token) {
          const metaPayload = {
            data: [{
              event_name:       eventName,
              event_time:       eventTime,
              event_id:         eventId,
              event_source_url: sourceUrl,
              action_source:    'website',
              user_data:        metaUserData,
              custom_data:      buildMetaCustomData(cd, eventName),
            }],
          };
          if (creds.meta.test_event_code) metaPayload.test_event_code = creds.meta.test_event_code;
          try {
            const res = await fetch(
              `https://graph.facebook.com/v20.0/${creds.meta.pixel_id}/events?access_token=${creds.meta.access_token}`,
              { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metaPayload) }
            );
            results.meta = { ok: res.ok, status: res.status };
          } catch (e) { results.meta = { ok: false, error: e.message }; }
        }

        // GA4 Measurement Protocol
        if (creds.ga4?.measurement_id && creds.ga4?.api_secret) {
          const isPageView = ['pageview','page_view'].includes(eventName.toLowerCase());
          if (!isPageView) {
            const ga4Payload = buildGA4Payload({
              eventName, sourceUrl, gaClientId, sessionId, utm, cd,
              userData: buildGA4UserData({ hashedEm, hashedPh, hashedFn, hashedLn,
                                           rawCity, rawState, rawZip, rawCountry }),
            });
            try {
              const res = await fetch(
                `https://www.google-analytics.com/mp/collect?measurement_id=${creds.ga4.measurement_id}&api_secret=${creds.ga4.api_secret}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ga4Payload) }
              );
              results.ga4 = { ok: res.ok, status: res.status };
            } catch (e) { results.ga4 = { ok: false, error: e.message }; }
          }
        }
      }

      // Persiste evento (exceto PageView)
      const isPageView = ['pageview','page_view'].includes(eventName.toLowerCase());
      if (!isPageView) {
        await db.run(
          `INSERT INTO event_log (
             client_id, session_id, event_name, event_id, page_id, timestamp,
             browser, os, is_mobile, pixel_was_blocked, fbp_source, is_bot,
             sent_to_meta, meta_response_ok, sent_to_ga4, ga4_response_ok,
             has_email, has_phone, has_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [clientId, sessionId, eventName, eventId, pageId, eventTime,
           detectBrowser(ua), detectOS(ua), isMobileUA(ua),
           pixelWasBlocked, fbpSource, isBot,
           !!creds.meta, results.meta?.ok || false,
           !!creds.ga4,  results.ga4?.ok  || false,
           !!rawEmail, !!rawPhone, !!(rawFirst || rawLast)]
        ).catch(e => fastify.log.warn('event_log error:', e.message));
      }

      return reply.send({ ok: true, event_id: eventId });
    } catch (e) {
      fastify.log.error(e);
      return reply.code(500).send({ error: 'internal_error' });
    }
  });
}

// ── Builders ─────────────────────────────────────────────────

function buildMetaCustomData(cd, eventName) {
  const out = {};
  if (cd.value    != null) out.value    = parseFloat(cd.value);
  if (cd.currency)         out.currency = cd.currency;
  if (cd.order_id)         out.order_id = cd.order_id;
  if (cd.content_name)     out.content_name = cd.content_name;
  if (cd.content_category) out.content_category = cd.content_category;
  if (cd.content_ids)      out.content_ids = cd.content_ids;
  if (cd.content_type)     out.content_type = cd.content_type;
  if (cd.num_items)        out.num_items = cd.num_items;
  if (cd.status)           out.status = cd.status;
  if (eventName === 'Purchase' && !out.currency) out.currency = 'BRL';
  return out;
}

function buildGA4UserData({ hashedEm, hashedPh, hashedFn, hashedLn,
                             rawCity, rawState, rawZip, rawCountry }) {
  const ud = {};
  if (hashedEm) ud.sha256_email_address = hashedEm;
  if (hashedPh) ud.sha256_phone_number  = hashedPh;
  const addr = {};
  if (hashedFn) addr.sha256_first_name = hashedFn;
  if (hashedLn) addr.sha256_last_name  = hashedLn;
  if (rawCity)    addr.city        = rawCity;
  if (rawState)   addr.region      = rawState;
  if (rawZip)     addr.postal_code = rawZip;
  if (rawCountry) addr.country     = rawCountry;
  if (Object.keys(addr).length) ud.address = addr;
  return Object.keys(ud).length ? ud : undefined;
}

function buildGA4Payload({ eventName, sourceUrl, gaClientId, sessionId, utm, cd, userData }) {
  const ga4Map = {
    Lead: 'generate_lead', Purchase: 'purchase',
    CompleteRegistration: 'sign_up', AddToCart: 'add_to_cart',
    InitiateCheckout: 'begin_checkout', ViewContent: 'view_item',
    Scroll: 'scroll', VideoView: 'video_start', Whatsapp: 'whatsapp',
  };
  const params = { engagement_time_msec: 100, page_location: sourceUrl };
  if (sessionId) params.session_id = sessionId;
  if (utm.source)   params.campaign_source  = utm.source;
  if (utm.medium)   params.campaign_medium  = utm.medium;
  if (utm.campaign) params.campaign_name    = utm.campaign;
  if (utm.content)  params.campaign_content = utm.content;
  if (utm.term)     params.campaign_term    = utm.term;
  if (cd.value    != null) params.value          = parseFloat(cd.value);
  if (cd.currency)         params.currency       = cd.currency;
  if (cd.order_id)         params.transaction_id = cd.order_id;
  if (cd.video_title)      params.video_title    = cd.video_title;
  if (cd.video_url)        params.video_url      = cd.video_url;
  if (cd.video_percent)    params.video_percent  = cd.video_percent;
  if (cd.percent_scrolled) params.percent_scrolled = cd.percent_scrolled;

  const payload = { client_id: gaClientId, events: [{ name: ga4Map[eventName] || eventName.toLowerCase(), params }] };
  if (userData) payload.user_data = userData;
  return payload;
}

// ── Utils ─────────────────────────────────────────────────────
function sha256(v) { return createHash('sha256').update(String(v)).digest('hex'); }
function normalizeName(s) { return (s||'').trim().toLowerCase(); }
function normalizePhone(ph) {
  const cc = '55';
  const d = (ph||'').replace(/\D/g,'').replace(/^0+/,'');
  if (!d) return '';
  if (d.startsWith(cc) && d.length >= cc.length+8) return d;
  if (d.length >= 8 && d.length <= 11) return cc + d;
  return d;
}
function validateFbCookie(v) {
  if (!v) return '';
  return (v.startsWith('fb.1.') || v.startsWith('fb.2.')) ? v : '';
}
function detectBot(ua='') {
  return { isBot: /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|mediapartners/i.test(ua) };
}
function detectBrowser(ua='') {
  if (/Chrome/.test(ua) && !/Edg/.test(ua)) return 'Chrome';
  if (/Firefox/.test(ua)) return 'Firefox';
  if (/Safari/.test(ua) && !/Chrome/.test(ua)) return 'Safari';
  if (/Edg/.test(ua)) return 'Edge';
  return 'Other';
}
function detectOS(ua='') {
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad/.test(ua)) return 'iOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac/.test(ua)) return 'MacOS';
  return 'Linux';
}
function isMobileUA(ua='') { return /Android|iPhone|iPad|Mobile/.test(ua); }
