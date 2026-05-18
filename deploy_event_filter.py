#!/usr/bin/env python3
"""
Deploy: filtro de eventos para Meta CAPI + seletor de evento por página de conversão
"""
import subprocess, re

# ── 1. Migration SQL ──────────────────────────────────────────────────────────
migration = """
ALTER TABLE conversion_pages
  ADD COLUMN IF NOT EXISTS meta_event_name VARCHAR(50) DEFAULT 'Lead',
  ADD COLUMN IF NOT EXISTS ga4_event_name  VARCHAR(50) DEFAULT 'generate_lead',
  ADD COLUMN IF NOT EXISTS send_to_meta    BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS send_to_ga4     BOOLEAN DEFAULT TRUE;

UPDATE conversion_pages
SET meta_event_name = COALESCE(meta_event_name, 'Lead'),
    ga4_event_name  = COALESCE(ga4_event_name,  'generate_lead'),
    send_to_meta    = COALESCE(send_to_meta, TRUE),
    send_to_ga4     = COALESCE(send_to_ga4,  TRUE)
WHERE meta_event_name IS NULL OR send_to_meta IS NULL;
"""
result = subprocess.run(
    ['sudo', '-u', 'postgres', 'psql', '-d', 'konverta', '-c', migration],
    capture_output=True, text=True
)
print("✓ Migration:", result.stdout.strip() or result.stderr.strip())

# ── 2. Patch collect.js ───────────────────────────────────────────────────────
collect_path = '/var/www/konverta/src/routes/collect.js'
with open(collect_path) as f:
    collect = f.read()

# Eventos que NUNCA vão para Meta CAPI (só se explicitamente configurado)
# PageView vai sempre. Scroll/Whatsapp/VideoView NÃO vão por padrão.
META_FILTER = '''
// ── Eventos que vão para Meta CAPI ────────────────────────────────────────
// PageView: sempre. Outros: só se for um evento de conversão configurado.
const META_CONVERSION_EVENTS = new Set([
  'Lead','Purchase','CompleteRegistration','ViewContent',
  'InitiateCheckout','AddToCart','AddPaymentInfo','Contact',
  'CustomizeProduct','Donate','FindLocation','Schedule',
  'StartTrial','SubmitApplication','Subscribe',
]);

// Busca configuração da página de conversão para este evento
let convPageConfig = null;
if (!isPageView && META_CONVERSION_EVENTS.has(eventName)) {
  // Usa page_id se fornecido, senão busca por event_name
  const pageQuery = pageId
    ? 'SELECT meta_event_name, ga4_event_name, send_to_meta, send_to_ga4 FROM conversion_pages WHERE id = $1 AND client_id = $2'
    : 'SELECT meta_event_name, ga4_event_name, send_to_meta, send_to_ga4 FROM conversion_pages WHERE client_id = $1 AND event_name = $2 LIMIT 1';
  const pageParams = pageId ? [pageId, clientId] : [clientId, eventName];
  convPageConfig = await db.queryOne(pageQuery, pageParams).catch(() => null);
}

// Decide se envia para Meta e qual nome de evento usar
const shouldSendMeta = isPageView || (convPageConfig?.send_to_meta !== false && META_CONVERSION_EVENTS.has(eventName));
const metaEventName  = isPageView ? 'PageView' : (convPageConfig?.meta_event_name || eventName);
const shouldSendGA4  = isPageView ? false : (convPageConfig?.send_to_ga4 !== false && !isPageView);
'''

# Insert after isPageView definition
old_check = "      const isPageView = ['pageview','page_view'].includes(eventName.toLowerCase());"
new_check  = old_check + "\n" + META_FILTER

if old_check in collect and 'META_CONVERSION_EVENTS' not in collect:
    collect = collect.replace(old_check, new_check)
    print("✓ collect.js: filtro de eventos adicionado")
else:
    print("⚠ collect.js: já tem filtro ou padrão não encontrado")

# Update the Meta CAPI call to use shouldSendMeta and metaEventName
old_meta_block = "        if (creds.meta?.pixel_id && creds.meta?.access_token) {"
new_meta_block = "        if (shouldSendMeta && creds.meta?.pixel_id && creds.meta?.access_token) {"
collect = collect.replace(old_meta_block, new_meta_block, 1)

# Update event_name in Meta payload to use metaEventName
old_meta_event = "            event_name:       eventName,"
new_meta_event = "            event_name:       metaEventName,"
collect = collect.replace(old_meta_event, new_meta_event, 1)

# Update GA4 condition to use shouldSendGA4
old_ga4_check = "        if (creds.ga4?.measurement_id && creds.ga4?.api_secret) {\n          const isPageView = ['pageview','page_view'].includes(eventName.toLowerCase());\n          if (!isPageView) {"
collect = collect.replace(
    "        if (creds.ga4?.measurement_id && creds.ga4?.api_secret) {\n          const isPageView = ['pageview','page_view'].includes(eventName.toLowerCase());\n          if (!isPageView) {",
    "        if (shouldSendGA4 && creds.ga4?.measurement_id && creds.ga4?.api_secret) {{\n          if (true) {"
)

# Simpler GA4 fix
collect = collect.replace(
    "        if (shouldSendGA4 && creds.ga4?.measurement_id && creds.ga4?.api_secret) {{\n          if (true) {",
    "        if (shouldSendGA4 && creds.ga4?.measurement_id && creds.ga4?.api_secret) {"
)

with open(collect_path, 'w') as f:
    f.write(collect)
print("✓ collect.js salvo")

# ── 3. Patch admin.html — adiciona seletor de evento na página de conversão ──
admin_path = '/var/www/konverta/public/admin.html'
with open(admin_path) as f:
    admin = f.read()

META_EVENT_OPTIONS = """
<option value="Lead">Lead</option>
<option value="CompleteRegistration">CompleteRegistration</option>
<option value="Purchase">Purchase</option>
<option value="ViewContent">ViewContent</option>
<option value="InitiateCheckout">InitiateCheckout</option>
<option value="Contact">Contact</option>
<option value="Schedule">Schedule</option>
<option value="SubmitApplication">SubmitApplication</option>
<option value="Subscribe">Subscribe</option>
"""

GA4_EVENT_OPTIONS = """
<option value="generate_lead">generate_lead</option>
<option value="purchase">purchase</option>
<option value="sign_up">sign_up</option>
<option value="view_item">view_item</option>
<option value="begin_checkout">begin_checkout</option>
<option value="contact">contact</option>
<option value="schedule">schedule</option>
<option value="submit_application">submit_application</option>
"""

# Find the page form fields and add event selectors after page_type
old_page_type = """<select class="form-input" id="page-event-type">
              <option value="lead_form">Formulário de Lead</option>
              <option value="purchase">Compra / Checkout</option>
              <option value="view_content">Visualização de Conteúdo</option>
              <option value="page_view">Page View</option>
            </select>"""

new_page_type = """<select class="form-input" id="page-event-type">
              <option value="lead_form">Formulário de Lead</option>
              <option value="purchase">Compra / Checkout</option>
              <option value="view_content">Visualização de Conteúdo</option>
              <option value="page_view">Page View</option>
            </select>
          </div>
          <div class="form-group" style="margin-top:12px">
            <label class="form-label">Evento Meta (CAPI)</label>
            <select class="form-input" id="page-meta-event">
              {meta_opts}
            </select>
          </div>
          <div class="form-group" style="margin-top:12px">
            <label class="form-label">Evento GA4</label>
            <select class="form-input" id="page-ga4-event">
              {ga4_opts}
            </select>
          </div>
          <div class="form-group" style="margin-top:12px;display:flex;gap:16px;align-items:center">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
              <input type="checkbox" id="page-send-meta" checked> Enviar para Meta CAPI
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
              <input type="checkbox" id="page-send-ga4" checked> Enviar para GA4
            </label>
          </div>""".replace('{meta_opts}', META_EVENT_OPTIONS).replace('{ga4_opts}', GA4_EVENT_OPTIONS)

if old_page_type in admin:
    admin = admin.replace(old_page_type, new_page_type)
    print("✓ admin.html: seletores de evento adicionados")
else:
    print("⚠ admin.html: padrão de page-event-type não encontrado — inserindo via append")
    # Find save page function and patch it
    pass

# ── 4. Patch savePage() to include new fields ─────────────────────────────────
old_save = """    const data = await apiFetch(`/api/admin/clients/${selectedClient.id}/pages${selectedPage ? '/'+selectedPage.id : ''}`, {
      method: selectedPage ? 'PUT' : 'POST',
      body: JSON.stringify({
        name:      document.getElementById('page-name').value,
        url:       document.getElementById('page-url').value,
        page_type: document.getElementById('page-event-type').value,
        field_map: parsedFields,
      }),
    });"""

new_save = """    const data = await apiFetch(`/api/admin/clients/${selectedClient.id}/pages${selectedPage ? '/'+selectedPage.id : ''}`, {
      method: selectedPage ? 'PUT' : 'POST',
      body: JSON.stringify({
        name:           document.getElementById('page-name').value,
        url:            document.getElementById('page-url').value,
        page_type:      document.getElementById('page-event-type').value,
        meta_event_name:document.getElementById('page-meta-event')?.value || 'Lead',
        ga4_event_name: document.getElementById('page-ga4-event')?.value || 'generate_lead',
        send_to_meta:   document.getElementById('page-send-meta')?.checked !== false,
        send_to_ga4:    document.getElementById('page-send-ga4')?.checked !== false,
        field_map: parsedFields,
      }),
    });"""

if old_save in admin:
    admin = admin.replace(old_save, new_save)
    print("✓ admin.html: savePage() atualizado")
else:
    print("⚠ admin.html: savePage() padrão não encontrado")

with open(admin_path, 'w') as f:
    f.write(admin)
print("✓ admin.html salvo")

# ── 5. Patch admin/index.js — save new fields ────────────────────────────────
admin_js_path = '/var/www/konverta/src/routes/admin/index.js'
with open(admin_js_path) as f:
    admin_js = f.read()

old_page_insert = """        `INSERT INTO conversion_pages (id, client_id, name, url, page_type, field_map, active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           name=$3, url=$4, page_type=$5, field_map=$6, updated_at=$8`,
        [pageId, clientId, name, url, page_type, JSON.stringify(field_map), now, now]"""

new_page_insert = """        `INSERT INTO conversion_pages (id, client_id, name, url, page_type, field_map,
           meta_event_name, ga4_event_name, send_to_meta, send_to_ga4, active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11,$12)
         ON CONFLICT (id) DO UPDATE SET
           name=$3, url=$4, page_type=$5, field_map=$6,
           meta_event_name=$7, ga4_event_name=$8, send_to_meta=$9, send_to_ga4=$10, updated_at=$12`,
        [pageId, clientId, name, url, page_type, JSON.stringify(field_map),
         meta_event_name||'Lead', ga4_event_name||'generate_lead',
         send_to_meta!==false, send_to_ga4!==false, now, now]"""

if old_page_insert in admin_js:
    admin_js = admin_js.replace(old_page_insert, new_page_insert)
    # Also destructure new fields from body
    old_destruct = "const { name, url, page_type, field_map } = req.body || {};"
    new_destruct  = "const { name, url, page_type, field_map, meta_event_name, ga4_event_name, send_to_meta, send_to_ga4 } = req.body || {};"
    admin_js = admin_js.replace(old_destruct, new_destruct)
    print("✓ admin_js: page save atualizado")
else:
    print("⚠ admin_js: page INSERT padrão não encontrado")

with open(admin_js_path, 'w') as f:
    f.write(admin_js)
print("✓ admin/index.js salvo")

# ── Restart ───────────────────────────────────────────────────────────────────
subprocess.run(['pm2', 'restart', 'konverta'])
print("\n✅ Deploy concluído!")
