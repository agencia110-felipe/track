import { db } from '../../db.js';
import { randomUUID } from '../../utils.js';
import { generateGTMExport } from '../../gtm-export.js';

export async function adminRoutes(fastify) {

  // ── CLIENTES ─────────────────────────────────────────────

  fastify.get('/api/admin/clients', async (req, reply) => {
    const clients = await db.query(`
      SELECT c.id, c.name, c.domain, c.dns_token, c.dns_verified, c.active,
             c.created_at,
             (SELECT COUNT(*) FROM event_log    WHERE client_id = c.id) AS total_events,
             (SELECT COUNT(*) FROM purchase_log WHERE client_id = c.id) AS total_purchases
      FROM clients c ORDER BY c.created_at DESC
    `);
    return { clients };
  });

  fastify.post('/api/admin/clients', async (req, reply) => {
    const { name, domain } = req.body || {};
    if (!name || !domain) return reply.code(400).send({ error: 'name and domain required' });

    const cleanDomain = domain.toLowerCase()
      .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    const id = randomUUID();
    const dnsToken = 'konverta-verify=' + randomUUID().replace(/-/g, '');
    const now = Date.now();

    try {
      await db.run(
        `INSERT INTO clients (id, name, domain, dns_token, dns_verified, active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,FALSE,TRUE,$5,$6)`,
        [id, name, cleanDomain, dnsToken, now, now]
      );
    } catch (e) {
      if (e.code === '23505') return reply.code(409).send({ error: 'domain_already_registered' });
      return reply.code(500).send({ error: e.message });
    }

    return reply.code(201).send({
      client: { id, name, domain: cleanDomain, dns_token: dnsToken, dns_verified: false },
      snippet: `<script src="https://${process.env.PLATFORM_DOMAIN}/c/${id}.js" async></script>`,
      dns_instructions: {
        type: 'TXT',
        host: `_konverta-verify.${cleanDomain}`,
        value: dnsToken,
        note: 'Adicione este TXT no DNS do cliente. Após propagar, clique em Verificar DNS.',
      },
    });
  });

  fastify.get('/api/admin/clients/:id', async (req, reply) => {
    const client = await db.queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!client) return reply.code(404).send({ error: 'not_found' });
    return { client };
  });

  fastify.delete('/api/admin/clients/:id', async (req, reply) => {
    await db.run('DELETE FROM clients WHERE id = $1', [req.params.id]);
    return { ok: true };
  });

  // ── DNS VERIFICATION ──────────────────────────────────────

  fastify.post('/api/admin/clients/:id/verify-dns', async (req, reply) => {
    const client = await db.queryOne(
      'SELECT id, domain, dns_token, dns_verified FROM clients WHERE id = $1',
      [req.params.id]
    );
    if (!client) return reply.code(404).send({ error: 'not_found' });
    if (client.dns_verified) return { verified: true, note: 'already_verified' };

    const txtHost = `_konverta-verify.${client.domain}`;
    const verified = await checkTxtRecord(txtHost, client.dns_token);

    if (verified) {
      await db.run(
        'UPDATE clients SET dns_verified = TRUE, updated_at = $1 WHERE id = $2',
        [Date.now(), client.id]
      );
      return { verified: true, domain: client.domain };
    }

    return {
      verified: false,
      domain: client.domain,
      expected_record: { type: 'TXT', host: txtHost, value: client.dns_token },
      note: 'TXT não encontrado ainda. DNS pode levar até 24h para propagar.',
    };
  });

  // ── PLATAFORMAS ───────────────────────────────────────────

  fastify.get('/api/admin/clients/:id/platforms', async (req, reply) => {
    const platforms = await db.query(
      'SELECT * FROM client_platforms WHERE client_id = $1 ORDER BY platform',
      [req.params.id]
    );
    // Mascara tokens na listagem
    const safe = platforms.map(p => ({
      ...p,
      access_token: p.access_token ? '••••••' + p.access_token.slice(-6) : '',
      api_secret: p.api_secret ? '••••' : '',
      tiktok_access_token: p.tiktok_access_token ? '••••' : '',
    }));
    return { platforms: safe };
  });

  fastify.post('/api/admin/clients/:id/platforms', async (req, reply) => {
    const clientId = req.params.id;
    const b = req.body || {};
    const { platform } = b;
    if (!platform) return reply.code(400).send({ error: 'platform required' });

    const now = Date.now();
    await db.run(
      `INSERT INTO client_platforms
         (client_id, platform, pixel_id, access_token, test_event_code,
          measurement_id, api_secret, conversion_id, conversion_label,
          tiktok_pixel_id, tiktok_access_token, enabled, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12)
       ON CONFLICT (client_id, platform) DO UPDATE SET
         pixel_id         = COALESCE(NULLIF(EXCLUDED.pixel_id,''),         client_platforms.pixel_id),
         access_token     = COALESCE(NULLIF(EXCLUDED.access_token,''),     client_platforms.access_token),
         test_event_code  = EXCLUDED.test_event_code,
         measurement_id   = COALESCE(NULLIF(EXCLUDED.measurement_id,''),   client_platforms.measurement_id),
         api_secret       = COALESCE(NULLIF(EXCLUDED.api_secret,''),       client_platforms.api_secret),
         conversion_id    = COALESCE(NULLIF(EXCLUDED.conversion_id,''),    client_platforms.conversion_id),
         conversion_label = COALESCE(NULLIF(EXCLUDED.conversion_label,''), client_platforms.conversion_label),
         tiktok_pixel_id      = COALESCE(NULLIF(EXCLUDED.tiktok_pixel_id,''),      client_platforms.tiktok_pixel_id),
         tiktok_access_token  = COALESCE(NULLIF(EXCLUDED.tiktok_access_token,''),  client_platforms.tiktok_access_token)`,
      [
        clientId, platform,
        b.pixel_id || '', b.access_token || '', b.test_event_code || '',
        b.measurement_id || '', b.api_secret || '',
        b.conversion_id || '', b.conversion_label || '',
        b.tiktok_pixel_id || '', b.tiktok_access_token || '',
        now,
      ]
    );
    return { ok: true };
  });

  fastify.delete('/api/admin/clients/:id/platforms/:platform', async (req, reply) => {
    await db.run(
      'DELETE FROM client_platforms WHERE client_id = $1 AND platform = $2',
      [req.params.id, req.params.platform]
    );
    return { ok: true };
  });

  // ── PÁGINAS DE CONVERSÃO ─────────────────────────────────

  fastify.get('/api/admin/clients/:id/pages', async (req, reply) => {
    const pages = await db.query(
      `SELECT id, name, page_type, event_name, url_pattern, url_match_type,
              field_map, fire_on, enabled, created_at
       FROM conversion_pages WHERE client_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    return { pages };
  });

  fastify.post('/api/admin/clients/:id/pages', async (req, reply) => {
    const clientId = req.params.id;
    const b = req.body || {};
    if (!b.name) return reply.code(400).send({ error: 'name required' });

    const now = Date.now();
    const result = await db.query(
      `INSERT INTO conversion_pages
         (client_id, name, page_type, event_name, url_pattern, url_match_type,
          field_map, source_html, fire_on, confirm_selector, enabled, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11,$12)
       RETURNING id`,
      [
        clientId, b.name, b.page_type || 'lead_form',
        b.event_name || 'Lead',
        b.url_pattern || null, b.url_match_type || 'contains',
        b.field_map || null, b.source_html || null,
        b.fire_on || 'submit', b.confirm_selector || null,
        now, now,
      ]
    );
    return reply.code(201).send({ ok: true, id: result[0]?.id });
  });

  fastify.put('/api/admin/clients/:id/pages/:pageId', async (req, reply) => {
    const b = req.body || {};
    await db.run(
      `UPDATE conversion_pages SET
         name=$1, page_type=$2, event_name=$3, url_pattern=$4, url_match_type=$5,
         field_map=$6, source_html=$7, fire_on=$8, updated_at=$9
       WHERE id=$10 AND client_id=$11`,
      [
        b.name, b.page_type, b.event_name, b.url_pattern||null, b.url_match_type||'contains',
        b.field_map||null, b.source_html||null, b.fire_on||'submit',
        Date.now(), req.params.pageId, req.params.id,
      ]
    );
    return { ok: true };
  });

  fastify.delete('/api/admin/clients/:id/pages/:pageId', async (req, reply) => {
    await db.run(
      'DELETE FROM conversion_pages WHERE id = $1 AND client_id = $2',
      [req.params.pageId, req.params.id]
    );
    return { ok: true };
  });

  // ── WEBHOOKS ──────────────────────────────────────────────

  fastify.get('/api/admin/clients/:id/webhooks', async (req, reply) => {
    const webhooks = await db.query(
      'SELECT * FROM client_webhooks WHERE client_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    const domain = process.env.PLATFORM_DOMAIN;
    const withUrls = webhooks.map(w => ({
      ...w,
      url: `https://${domain}/webhook/${w.platform}/${w.slug}`,
    }));
    return { webhooks: withUrls };
  });

  fastify.post('/api/admin/clients/:id/webhooks', async (req, reply) => {
    const { platform } = req.body || {};
    const validPlatforms = ['hotmart', 'kiwify', 'eduzz', 'wake', 'magento'];
    if (!validPlatforms.includes(platform))
      return reply.code(400).send({ error: 'invalid platform' });

    const slug = randomUUID().replace(/-/g, '');
    const now  = Date.now();
    await db.run(
      `INSERT INTO client_webhooks (client_id, platform, slug, enabled, created_at)
       VALUES ($1,$2,$3,TRUE,$4)`,
      [req.params.id, platform, slug, now]
    );

    const domain = process.env.PLATFORM_DOMAIN;
    return reply.code(201).send({
      ok: true,
      slug,
      url: `https://${domain}/webhook/${platform}/${slug}`,
    });
  });

  fastify.delete('/api/admin/clients/:id/webhooks/:webhookId', async (req, reply) => {
    await db.run(
      'DELETE FROM client_webhooks WHERE id = $1 AND client_id = $2',
      [req.params.webhookId, req.params.id]
    );
    return { ok: true };
  });

  // ── GTM EXPORT ────────────────────────────────────────────

  fastify.get('/api/admin/clients/:id/gtm-export', async (req, reply) => {
    const clientId = req.params.id;

    const client = await db.queryOne('SELECT * FROM clients WHERE id = $1', [clientId]);
    if (!client) return reply.code(404).send({ error: 'not_found' });

    // Busca credenciais
    const platforms = await db.query(
      'SELECT * FROM client_platforms WHERE client_id = $1 AND enabled = TRUE',
      [clientId]
    );
    const creds = {};
    platforms.forEach(p => { creds[p.platform] = p; });

    // Busca páginas para extrair seletores de campo
    const pages = await db.query(
      'SELECT * FROM conversion_pages WHERE client_id = $1 AND enabled = TRUE LIMIT 1',
      [clientId]
    );
    const firstPage = pages[0];
    let fieldSelectors = {};
    if (firstPage?.field_map) {
      try {
        const fields = JSON.parse(firstPage.field_map);
        fields.forEach(f => {
          if (f.field === 'email')     fieldSelectors.email     = f.original_name || f.original_id || 'form-field-email';
          if (f.field === 'phone')     fieldSelectors.phone     = f.original_name || f.original_id || 'form-field-phone';
          if (f.field === 'name')      fieldSelectors.firstname = f.original_name || f.original_id || 'form-field-firstname';
          if (f.field === 'last_name') fieldSelectors.lastname  = f.original_name || f.original_id || 'form-field-lastname';
        });
      } catch (e) {}
    }

    const gtmJson = generateGTMExport({
      clientName:         client.name,
      ga4MeasurementId:   creds.ga4?.measurement_id || '',
      metaPixelId:        creds.meta?.pixel_id || '',
      googleAdsTagId:     creds.google_ads?.conversion_id || '',
      googleAdsLeadLabel: creds.google_ads?.conversion_label || '',
      apiTransportUrl:    `https://${process.env.PLATFORM_DOMAIN}`,
      fieldSelectors,
    });

    const filename = `GTM-Konverta-${client.name.replace(/\s+/g, '-')}.json`;
    return reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(gtmJson);
  });

  // ── PARSE FORM HTML ───────────────────────────────────────

  fastify.post('/api/parse-form', async (req, reply) => {
    const { html } = req.body || {};
    if (!html) return reply.code(400).send({ error: 'html required' });
    return { fields: parseFormFields(html) };
  });
}

// ── Helpers ────────────────────────────────────────────────

async function checkTxtRecord(host, expectedValue) {
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${host}&type=TXT`, {
      headers: { Accept: 'application/dns-json' },
    });
    const data = await res.json();
    return (data.Answer || []).some(a => (a.data || '').replace(/"/g, '').includes(expectedValue));
  } catch (e) { return false; }
}

function parseFormFields(html) {
  const fields = [];
  const seen = new Set();
  const inputRe = /<(input|select|textarea)([^>]*)>/gi;
  const skipTypes = ['hidden', 'submit', 'button', 'reset', 'image', 'file', 'checkbox', 'radio'];

  let match;
  while ((match = inputRe.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    const id = getAttr(attrs, 'id');
    const name = getAttr(attrs, 'name');
    const type = getAttr(attrs, 'type') || (tag === 'select' ? 'select' : 'text');
    const placeholder = getAttr(attrs, 'placeholder');
    const className = getAttr(attrs, 'class');

    if (skipTypes.includes(type.toLowerCase())) continue;

    let selector = '';
    if (id)        selector = `#${cssEscape(id)}`;
    else if (name) selector = `${tag}[name="${name}"]`;
    else if (className) {
      const cls = className.split(/\s+/).find(c => c.length > 2 && !/^(form|input|field|col|row|wrap)$/.test(c));
      if (cls) selector = `${tag}.${cssEscape(cls)}`;
    }
    if (!selector || seen.has(selector)) continue;
    seen.add(selector);

    const fieldType = inferFieldType(id, name, placeholder, type);
    if (!fieldType) continue;

    const label = findLabel(html, id) || placeholder || name || '';
    fields.push({ field: fieldType, selector, type: type.toLowerCase(), label, original_id: id, original_name: name });
  }
  return fields;
}

function inferFieldType(id, name, placeholder, type) {
  const s = [id, name, placeholder, type].map(v => (v || '').toLowerCase()).join(' ');
  if (type === 'email' || /e[\-_]?mail|correo/.test(s)) return 'email';
  if (type === 'tel'   || /\b(tel|fone|celular|whatsapp|phone|cel)\b/.test(s)) return 'phone';
  if (/\b(full[\-_ ]?name|nome[\-_ ]?completo|nombre[\-_ ]?completo)\b/.test(s)) return 'name';
  if (/\b(first[\-_ ]?name|nome|nombre|primeiro)\b/.test(s) && !/sobrenome|last/.test(s)) return 'name';
  if (/\b(last[\-_ ]?name|sobrenome|apellido)\b/.test(s)) return 'last_name';
  if (/\bcpf\b/.test(s)) return 'cpf';
  if (/\b(valor|value|preco|price|amount|total)\b/.test(s)) return 'value';
  if (/\b(order[\-_ ]?id|pedido|numero[\-_ ]?pedido)\b/.test(s)) return 'order_id';
  return null;
}

function findLabel(html, id) {
  if (!id) return '';
  const re = new RegExp(`<label[^>]+for=["']?${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?[^>]*>([^<]+)<`, 'i');
  const m = html.match(re);
  return m ? m[1].trim() : '';
}

function getAttr(attrs, name) {
  const re = new RegExp(`\\b${name}=["']?([^"'\\s>]+)["']?`, 'i');
  const m = attrs.match(re);
  return m ? m[1] : '';
}

function cssEscape(s) {
  return s.replace(/([!"#$%&'()*+,./;<=>?@[\\\]^`{|}~])/g, '\\$1');
}
