/**
 * GTM Export Generator — Konverta
 * Gera o JSON de container do GTM pronto para importar.
 * Segue o padrão de configuração da agência:
 * - Variáveis: ga4-tag-id, meta-pixel-id, meta-token, api-transport-url, api-event-id, user data JS, cookies
 * - Tags: GA4 PageView, Meta PageView, API PageView, GA4 Lead, Meta Lead, API Lead, Google Ads Lead
 * - Acionadores: All Pages, Lead (form submit + click), VideoView, Scroll, WhatsApp
 * - Set Cookies: LeadFirstName, LeadLastName, LeadEmail, LeadPhone
 */

export function generateGTMExport(config) {
  const {
    clientName,
    ga4MeasurementId,    // ex: G-XXXXXXXXXX
    metaPixelId,
    googleAdsTagId,      // ex: AW-XXXXXXXXXX
    googleAdsLeadLabel,  // ex: AbCdEfGhIjKlMnOp
    apiTransportUrl,     // ex: https://track.agencia110.com.br
    // Seletores dos campos do formulário (extraídos pelo parse-form)
    fieldSelectors = {}, // { email, phone, firstname, lastname }
    // ID do botão de submit (se não usar form submit)
    submitButtonId,
    containerName = `[WEB] KONVERTA - ${clientName}`,
  } = config;

  // IDs únicos sequenciais
  let _id = 1;
  const id = () => String(_id++);

  // ── VARIÁVEIS ────────────────────────────────────────────────

  const varGA4TagId = mkVarConstant(id(), 'ga4-tag id', ga4MeasurementId || 'G-XXXXXXXXXX');
  const varMetaPixelId = mkVarConstant(id(), 'meta ads-pixel id', metaPixelId || 'SEU_PIXEL_ID');
  const varGoogleAdsTagId = mkVarConstant(id(), 'google ads-tag id', googleAdsTagId || 'AW-XXXXXXXXXX');
  const varGoogleAdsLeadId = mkVarConstant(id(), 'google ads-lead id', googleAdsLeadLabel || 'SEU_LABEL_AQUI');
  const varTransportUrl = mkVarConstant(id(), 'api-transport_url', apiTransportUrl || 'https://track.agencia110.com.br');
  const varEventId = mkVarEventId(id(), 'api-event_id');

  // Variáveis de campos do formulário (JavaScript Personalizado)
  const varFirstname = mkVarJsField(id(), 'user-js-firstname', fieldSelectors.firstname || 'form-field-firstname', true);
  const varLastname  = mkVarJsField(id(), 'user-js-lastname',  fieldSelectors.lastname  || 'form-field-lastname',  true);
  const varEmail     = mkVarJsField(id(), 'user-js-email',     fieldSelectors.email     || 'form-field-email',     true);
  const varPhone     = mkVarJsFieldPhone(id(), 'user-js-phone', fieldSelectors.phone || 'form-field-phone');

  // Cookies de lead (para uso em tags de remarketing)
  const varCookieFirstName  = mkVarCookie(id(), 'cookie-LeadFirstName', 'LeadFirstName');
  const varCookieLastName   = mkVarCookie(id(), 'cookie-LeadLastName',  'LeadLastName');
  const varCookieEmail      = mkVarCookie(id(), 'cookie-LeadEmail',     'LeadEmail');
  const varCookiePhone      = mkVarCookie(id(), 'cookie-LeadPhone',     'LeadPhone');
  const varCookieGA         = mkVarCookie(id(), 'cookie-ga',            '_ga');
  const varCookieFbp        = mkVarCookie(id(), 'Meta_fbp',             '_fbp');
  const varCookieFbc        = mkVarCookie(id(), 'Meta_fbc',             '_fbc');

  // user_data Google — configurações de eventos para GA4
  const varUserDataGA4Js = mkVarGA4UserData(id(), 'user_data-ga4-js-all data', {
    email: '{{user-js-email}}', phone: '{{user-js-phone}}',
    firstname: '{{user-js-firstname}}', lastname: '{{user-js-lastname}}',
  });
  const varUserDataGA4Cookie = mkVarGA4UserData(id(), 'user_data-ga4-cookie-all data', {
    email: '{{cookie-LeadEmail}}', phone: '{{cookie-LeadPhone}}',
    firstname: '{{cookie-LeadFirstName}}', lastname: '{{cookie-LeadLastName}}',
  });

  // user_data Google Ads
  const varUserDataGoogleJs = mkVarGoogleUserData(id(), 'user_data-google-js-all data', '{{user-js-email}}', '{{user-js-phone}}');
  const varUserDataGoogleCookie = mkVarGoogleUserData(id(), 'user_data-google-cookie-all data', '{{cookie-LeadEmail}}', '{{cookie-LeadPhone}}');

  const variables = [
    varGA4TagId, varMetaPixelId, varGoogleAdsTagId, varGoogleAdsLeadId,
    varTransportUrl, varEventId,
    varFirstname, varLastname, varEmail, varPhone,
    varCookieFirstName, varCookieLastName, varCookieEmail, varCookiePhone,
    varCookieGA, varCookieFbp, varCookieFbc,
    varUserDataGA4Js, varUserDataGA4Cookie,
    varUserDataGoogleJs, varUserDataGoogleCookie,
  ];

  // ── ACIONADORES ──────────────────────────────────────────────

  const trigAllPages    = mkTrigAllPages(id());
  const trigLead        = submitButtonId
    ? mkTrigLeadClick(id(), submitButtonId)
    : mkTrigFormSubmit(id());
  const trigVideoView   = mkTrigVideoView(id());
  const trigScroll      = mkTrigScroll(id());
  const trigWhatsapp    = mkTrigWhatsapp(id());

  const triggers = [trigAllPages, trigLead, trigVideoView, trigScroll, trigWhatsapp];

  // ── TAGS ─────────────────────────────────────────────────────

  const tags = [
    // ── GA4 ─────────────────────────────────────────────
    mkTagGA4Config(id(), trigAllPages.triggerId),
    mkTagGA4Lead(id(), trigLead.triggerId),
    mkTagGA4VideoView(id(), trigVideoView.triggerId),
    mkTagGA4Scroll(id(), trigScroll.triggerId),
    mkTagGA4Whatsapp(id(), trigWhatsapp.triggerId),

    // ── META ADS (pixel browser) ─────────────────────────
    mkTagMetaPageView(id(), trigAllPages.triggerId),
    mkTagMetaLead(id(), trigLead.triggerId),
    mkTagMetaVideoView(id(), trigVideoView.triggerId),
    mkTagMetaScroll(id(), trigScroll.triggerId),
    mkTagMetaWhatsapp(id(), trigWhatsapp.triggerId),

    // ── API (sGTM / GA4 Event com transport_url) ─────────
    mkTagApiPageView(id(), trigAllPages.triggerId),
    mkTagApiLead(id(), trigLead.triggerId),
    mkTagApiVideoView(id(), trigVideoView.triggerId),
    mkTagApiScroll(id(), trigScroll.triggerId),
    mkTagApiWhatsapp(id(), trigWhatsapp.triggerId),

    // ── GOOGLE ADS ────────────────────────────────────────
    mkTagGAdsConversionLinker(id(), trigAllPages.triggerId),
    mkTagGAdsPageView(id(), trigAllPages.triggerId),
    mkTagGAdsLead(id(), trigLead.triggerId),

    // ── SET COOKIES ──────────────────────────────────────
    mkTagSetCookies(id(), trigLead.triggerId),
  ];

  // ── CONTAINER EXPORT FORMAT ──────────────────────────────────
  return {
    exportFormatVersion: 2,
    exportTime: new Date().toISOString().replace('T', ' ').replace(/\.\d+Z/, ''),
    containerVersion: {
      path: 'accounts/0/containers/0/versions/0',
      container: {
        path: 'accounts/0/containers/0',
        accountId: '0',
        containerId: '0',
        name: containerName,
        publicId: 'GTM-KONVERTA',
        usageContext: ['WEB'],
        domainName: [],
        fingerprint: '',
        tagManagerUrl: '',
      },
      variable: variables,
      trigger: triggers,
      tag: tags,
    },
  };
}

// ══════════════════════════════════════════════════════════════
// BUILDERS DE VARIÁVEIS
// ══════════════════════════════════════════════════════════════

function mkVarConstant(id, name, value) {
  return { variableId: id, name, type: 'c', parameter: [{ type: 'TEMPLATE', key: 'value', value }] };
}

function mkVarEventId(id, name) {
  return {
    variableId: id, name, type: 'jsm',
    parameter: [{
      type: 'TEMPLATE', key: 'javascript',
      value: `function() {
  try {
    var id = window._konverta_eid;
    if (!id) {
      id = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,function(c){return(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16)});
      window._konverta_eid = id;
    }
    return id;
  } catch(e) { return Date.now().toString(36); }
}`,
    }],
  };
}

function mkVarJsField(id, name, fieldId, lowercase = false) {
  return {
    variableId: id, name, type: 'jsm',
    parameter: [{
      type: 'TEMPLATE', key: 'javascript',
      value: `function() {
  try {
    var el = document.querySelector('[id="${fieldId}"], [name="${fieldId}"], .${fieldId}');
    if (!el) return undefined;
    var v = (el.value || '').trim();
    ${lowercase ? "return v ? v.toLowerCase() : undefined;" : "return v || undefined;"}
  } catch(e) { return undefined; }
}`,
    }],
  };
}

function mkVarJsFieldPhone(id, name, fieldId) {
  return {
    variableId: id, name, type: 'jsm',
    parameter: [{
      type: 'TEMPLATE', key: 'javascript',
      value: `function() {
  try {
    var el = document.querySelector('[id="${fieldId}"], [name="${fieldId}"], .${fieldId}');
    if (!el) return undefined;
    var v = (el.value || '').replace(/\\D/g, '').replace(/^0+/, '');
    if (!v) return undefined;
    if (v.length >= 8 && v.length <= 11) v = '55' + v;
    return v;
  } catch(e) { return undefined; }
}`,
    }],
  };
}

function mkVarCookie(id, name, cookieName) {
  return { variableId: id, name, type: 'k', parameter: [{ type: 'TEMPLATE', key: 'name', value: cookieName }] };
}

function mkVarGA4UserData(id, name, fields) {
  return {
    variableId: id, name, type: 'gtes',
    parameter: [
      { type: 'BOOLEAN', key: 'first_party_collection', value: 'true' },
      { type: 'TEMPLATE', key: 'user_data.email_address', value: fields.email },
      { type: 'TEMPLATE', key: 'user_data.phone_number',  value: fields.phone },
      { type: 'TEMPLATE', key: 'user_data.address.first_name', value: fields.firstname },
      { type: 'TEMPLATE', key: 'user_data.address.last_name',  value: fields.lastname },
    ],
  };
}

function mkVarGoogleUserData(id, name, email, phone) {
  return {
    variableId: id, name, type: 'udd',
    parameter: [
      { type: 'BOOLEAN', key: 'manualConfiguration', value: 'true' },
      { type: 'TEMPLATE', key: 'email', value: email },
      { type: 'TEMPLATE', key: 'phone', value: phone },
    ],
  };
}

// ══════════════════════════════════════════════════════════════
// BUILDERS DE ACIONADORES
// ══════════════════════════════════════════════════════════════

function mkTrigAllPages(id) {
  return { triggerId: id, name: 'All Pages', type: 'PAGEVIEW' };
}

function mkTrigFormSubmit(id) {
  return { triggerId: id, name: 'Evento Lead', type: 'FORM_SUBMISSION',
    waitForTags: { type: 'BOOLEAN', value: 'true' },
    checkValidation: { type: 'BOOLEAN', value: 'true' },
    waitForTagsTimeout: { type: 'TEMPLATE', value: '2000' },
  };
}

function mkTrigLeadClick(id, buttonId) {
  return {
    triggerId: id, name: 'Evento Lead', type: 'CLICK',
    filter: [{ type: 'EQUALS', parameter: [
      { type: 'TEMPLATE', key: 'arg0', value: '{{Click ID}}' },
      { type: 'TEMPLATE', key: 'arg1', value: buttonId },
    ]}],
  };
}

function mkTrigVideoView(id) {
  return {
    triggerId: id, name: 'Evento VideoView', type: 'YOU_TUBE_VIDEO',
    videoPercentageList: { type: 'LIST', list: [
      { type: 'TEMPLATE', value: '10' }, { type: 'TEMPLATE', value: '25' },
      { type: 'TEMPLATE', value: '50' }, { type: 'TEMPLATE', value: '75' },
    ]},
    videoStartOption: { type: 'BOOLEAN', value: 'true' },
    videoCompleteOption: { type: 'BOOLEAN', value: 'true' },
    videoProgressOption: { type: 'BOOLEAN', value: 'true' },
    supportDocumentWrite: { type: 'BOOLEAN', value: 'true' },
  };
}

function mkTrigScroll(id) {
  return {
    triggerId: id, name: 'Evento Scroll', type: 'SCROLL_DEPTH',
    verticalThresholdUnits: { type: 'TEMPLATE', value: 'PERCENT' },
    verticalThresholds: { type: 'LIST', list: [
      '10','25','50','75','90'
    ].map(v => ({ type: 'TEMPLATE', value: v }))},
    triggerStartOption: { type: 'TEMPLATE', value: 'WINDOW_LOAD' },
  };
}

function mkTrigWhatsapp(id) {
  return {
    triggerId: id, name: 'Evento Botão Whatsapp', type: 'LINK_CLICK',
    waitForTags: { type: 'BOOLEAN', value: 'true' },
    waitForTagsTimeout: { type: 'TEMPLATE', value: '2000' },
    checkValidation: { type: 'BOOLEAN', value: 'true' },
    filter: [{ type: 'CONTAINS', parameter: [
      { type: 'TEMPLATE', key: 'arg0', value: '{{Click URL}}' },
      { type: 'TEMPLATE', key: 'arg1', value: 'whatsapp' },
    ]}],
  };
}

// ══════════════════════════════════════════════════════════════
// BUILDERS DE TAGS
// ══════════════════════════════════════════════════════════════

function mkTagGA4Config(id, triggerId) {
  return {
    tagId: id, name: '[GA4] 1 | PageView', type: 'googtag',
    parameter: [
      { type: 'TEMPLATE', key: 'tagId', value: '{{ga4-tag id}}' },
      { type: 'LIST', key: 'configSettingsTable', list: [
        mkParam('send_page_view', 'true'),
      ]},
    ],
    firingTriggerId: [triggerId],
    tagFiringOption: 'ONCE_PER_PAGE',
  };
}

function mkTagGA4Lead(id, triggerId) {
  return {
    tagId: id, name: '[GA4] 0 | Lead', type: 'gaawe',
    parameter: [
      { type: 'TEMPLATE', key: 'measurementIdOverride', value: '{{ga4-tag id}}' },
      { type: 'TEMPLATE', key: 'eventName', value: 'generate_lead' },
    ],
    firingTriggerId: [triggerId], tagFiringOption: 'ONCE_PER_PAGE',
  };
}

function mkTagGA4VideoView(id, triggerId) {
  return {
    tagId: id, name: '[GA4] 0 | VideoView', type: 'gaawe',
    parameter: [
      { type: 'TEMPLATE', key: 'measurementIdOverride', value: '{{ga4-tag id}}' },
      { type: 'TEMPLATE', key: 'eventName', value: 'video_start' },
      { type: 'LIST', key: 'eventSettingsTable', list: [
        mkParam('video_provider', '{{Video Provider}}'),
        mkParam('video_title',    '{{Video Title}}'),
        mkParam('video_url',      '{{Video URL}}'),
        mkParam('video_status',   '{{Video Status}}'),
        mkParam('video_percent',  '{{Video Percent}}'),
      ]},
    ],
    firingTriggerId: [triggerId], tagFiringOption: 'ONCE_PER_EVENT',
  };
}

function mkTagGA4Scroll(id, triggerId) {
  return {
    tagId: id, name: '[GA4] 0 | Scroll', type: 'gaawe',
    parameter: [
      { type: 'TEMPLATE', key: 'measurementIdOverride', value: '{{ga4-tag id}}' },
      { type: 'TEMPLATE', key: 'eventName', value: 'scroll' },
      { type: 'LIST', key: 'eventSettingsTable', list: [
        mkParam('percent_scrolled', '{{Scroll Depth Threshold}}'),
      ]},
    ],
    firingTriggerId: [triggerId], tagFiringOption: 'ONCE_PER_EVENT',
  };
}

function mkTagGA4Whatsapp(id, triggerId) {
  return {
    tagId: id, name: '[GA4] 0 | Whatsapp', type: 'gaawe',
    parameter: [
      { type: 'TEMPLATE', key: 'measurementIdOverride', value: '{{ga4-tag id}}' },
      { type: 'TEMPLATE', key: 'eventName', value: 'whatsapp' },
    ],
    firingTriggerId: [triggerId], tagFiringOption: 'ONCE_PER_PAGE',
  };
}

function mkTagMetaPageView(id, triggerId) {
  return {
    tagId: id, name: '[Meta Ads] 1 | PageView',
    type: 'html',
    parameter: [{ type: 'TEMPLATE', key: 'html', value: `<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '{{meta ads-pixel id}}', {
  external_id: '{{cookie-ga}}',
  fbp: '{{Meta_fbp}}',
  fbc: '{{Meta_fbc}}'
});
fbq('track', 'PageView', {}, {eventID: '{{api-event_id}}'});
</script><noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id={{meta ads-pixel id}}&ev=PageView&noscript=1"/></noscript>` }],
    firingTriggerId: [triggerId], tagFiringOption: 'ONCE_PER_PAGE',
  };
}

function mkTagMetaLead(id, triggerId) {
  return {
    tagId: id, name: '[Meta Ads] 0 | Lead',
    type: 'html',
    parameter: [{ type: 'TEMPLATE', key: 'html', value: `<script>
fbq('track', 'Lead', {}, {
  eventID: '{{api-event_id}}',
  user_data: {
    em: '{{user-js-email}}',
    fn: '{{user-js-firstname}}',
    ln: '{{user-js-lastname}}',
    ph: '{{user-js-phone}}',
    external_id: '{{cookie-ga}}',
    fbp: '{{Meta_fbp}}',
    fbc: '{{Meta_fbc}}'
  }
});
</script>` }],
    firingTriggerId: [triggerId], tagFiringOption: 'ONCE_PER_PAGE',
  };
}

function mkTagMetaVideoView(id, triggerId) {
  return {
    tagId: id, name: '[Meta Ads] 0 | VideoView', type: 'html',
    parameter: [{ type: 'TEMPLATE', key: 'html', value: `<script>
fbq('trackCustom', 'VideoView', {
  video_provider: '{{Video Provider}}',
  video_title: '{{Video Title}}',
  video_url: '{{Video URL}}',
  video_status: '{{Video Status}}',
  video_percent: '{{Video Percent}}'
}, {
  eventID: '{{api-event_id}}',
  user_data: { em:'{{cookie-LeadEmail}}', fn:'{{cookie-LeadFirstName}}', ln:'{{cookie-LeadLastName}}', ph:'{{cookie-LeadPhone}}', external_id:'{{cookie-ga}}' }
});
</script>` }],
    firingTriggerId: [triggerId], tagFiringOption: 'ONCE_PER_EVENT',
  };
}

function mkTagMetaScroll(id, triggerId) {
  return {
    tagId: id, name: '[Meta Ads] 0 | Scroll', type: 'html',
    parameter: [{ type: 'TEMPLATE', key: 'html', value: `<script>
fbq('trackCustom', 'Scroll', {
  percent_scrolled: '{{Scroll Depth Threshold}}'
}, {
  eventID: '{{api-event_id}}',
  user_data: { em:'{{cookie-LeadEmail}}', fn:'{{cookie-LeadFirstName}}', ln:'{{cookie-LeadLastName}}', ph:'{{cookie-LeadPhone}}', external_id:'{{cookie-ga}}' }
});
</script>` }],
    firingTriggerId: [triggerId], tagFiringOption: 'ONCE_PER_EVENT',
  };
}

function mkTagMetaWhatsapp(id, triggerId) {
  return {
    tagId: id, name: '[Meta Ads] 0 | Whatsapp', type: 'html',
    parameter: [{ type: 'TEMPLATE', key: 'html', value: `<script>
fbq('trackCustom', 'Whatsapp', {}, {
  eventID: '{{api-event_id}}',
  user_data: { em:'{{cookie-LeadEmail}}', fn:'{{cookie-LeadFirstName}}', ln:'{{cookie-LeadLastName}}', ph:'{{cookie-LeadPhone}}', external_id:'{{cookie-ga}}' }
});
</script>` }],
    firingTriggerId: [triggerId], tagFiringOption: 'ONCE_PER_PAGE',
  };
}

function mkTagApiPageView(id, triggerId) {
  return {
    tagId: id, name: '[API] 1 | PageView', type: 'gaawe',
    parameter: [
      { type: 'TEMPLATE', key: 'measurementIdOverride', value: '{{ga4-tag id}}' },
      { type: 'TEMPLATE', key: 'eventName', value: 'PageView' },
      { type: 'LIST', key: 'eventSettingsTable', list: [
        mkParam('event_id', '{{api-event_id}}'),
        mkParam('transport_url', '{{api-transport_url}}'),
      ]},
    ],
    firingTriggerId: [triggerId], tagFiringOption: 'ONCE_PER_PAGE',
  };
}

function mkTagApiLead(id, triggerId) {
  return {
    tagId: id, name: '[API] 0 | Lead', type: 'gaawe',
    parameter: [
      { type: 'TEMPLATE', key: 'measurementIdOverride', value: '{{ga4-tag id}}' },
      { type: 'TEMPLATE', key: 'eventName', value: 'Lead' },
      { type: 'TEMPLATE', key: 'eventSettingsVariable', value: '{{user_data-ga4-js-all data}}' },
      { type: 'LIST', key: 'eventSettingsTable', list: [
        mkParam('event_id', '{{api-event_id}}'),
        mkParam('transport_url', '{{api-transport_url}}'),
      ]},
    ],
    firingTriggerId: [triggerId], tagFiringOption: 'ONCE_PER_PAGE',
  };
}

function mkTagApiVideoView(id, triggerId) {
  return {
    tagId: id, name: '[API] 0 | VideoView', type: 'gaawe',
    parameter: [
      { type: 'TEMPLATE', key: 'measurementIdOverride', value: '{{ga4-tag id}}' },
      { type: 'TEMPLATE', key: 'eventName', value: 'VideoView' },
      { type: 'TEMPLATE', key: 'eventSettingsVariable', value: '{{user_data-ga4-cookie-all data}}' },
      { type: 'LIST', key: 'eventSettingsTable', list: [
        mkParam('event_id', '{{api-event_id}}'),
        mkParam('transport_url', '{{api-transport_url}}'),
        mkParam('video_provider', '{{Video Provider}}'),
        mkParam('video_title', '{{Video Title}}'),
        mkParam('video_url', '{{Video URL}}'),
        mkParam('video_status', '{{Video Status}}'),
        mkParam('video_percent', '{{Video Percent}}'),
      ]},
    ],
    firingTriggerId: [triggerId], tagFiringOption: 'ONCE_PER_EVENT',
  };
}

function mkTagApiScroll(id, triggerId) {
  return {
    tagId: id, name: '[API] 0 | Scroll', type: 'gaawe',
    parameter: [
      { type: 'TEMPLATE', key: 'measurementIdOverride', value: '{{ga4-tag id}}' },
      { type: 'TEMPLATE', key: 'eventName', value: 'Scroll' },
      { type: 'TEMPLATE', key: 'eventSettingsVariable', value: '{{user_data-ga4-cookie-all data}}' },
      { type: 'LIST', key: 'eventSettingsTable', list: [
        mkParam('event_id', '{{api-event_id}}'),
        mkParam('transport_url', '{{api-transport_url}}'),
        mkParam('percent_scrolled', '{{Scroll Depth Threshold}}'),
      ]},
    ],
    firingTriggerId: [triggerId], tagFiringOption: 'ONCE_PER_EVENT',
  };
}

function mkTagApiWhatsapp(id, triggerId) {
  return {
    tagId: id, name: '[API] 0 | Whatsapp', type: 'gaawe',
    parameter: [
      { type: 'TEMPLATE', key: 'measurementIdOverride', value: '{{ga4-tag id}}' },
      { type: 'TEMPLATE', key: 'eventName', value: 'Whatsapp' },
      { type: 'TEMPLATE', key: 'eventSettingsVariable', value: '{{user_data-ga4-cookie-all data}}' },
      { type: 'LIST', key: 'eventSettingsTable', list: [
        mkParam('event_id', '{{api-event_id}}'),
        mkParam('transport_url', '{{api-transport_url}}'),
      ]},
    ],
    firingTriggerId: [triggerId], tagFiringOption: 'ONCE_PER_PAGE',
  };
}

function mkTagGAdsConversionLinker(id, triggerId) {
  return {
    tagId: id, name: '[Google Ads] 0 | Vinculador de conversões', type: 'awct',
    parameter: [{ type: 'BOOLEAN', key: 'enableCrossDomainLinking', value: 'false' }],
    firingTriggerId: [triggerId], tagFiringOption: 'ONCE_PER_PAGE',
  };
}

function mkTagGAdsPageView(id, triggerId) {
  return {
    tagId: id, name: '[Google Ads] 1 | PageView', type: 'sp',
    parameter: [
      { type: 'TEMPLATE', key: 'conversionId', value: '{{google ads-tag id}}' },
    ],
    firingTriggerId: [triggerId], tagFiringOption: 'ONCE_PER_PAGE',
  };
}

function mkTagGAdsLead(id, triggerId) {
  return {
    tagId: id, name: '[Google Ads] 0 | Lead', type: 'awct',
    parameter: [
      { type: 'TEMPLATE', key: 'conversionId',    value: '{{google ads-tag id}}' },
      { type: 'TEMPLATE', key: 'conversionLabel', value: '{{google ads-lead id}}' },
      { type: 'BOOLEAN',  key: 'enableUserData',  value: 'true' },
      { type: 'TEMPLATE', key: 'userDataVariable', value: '{{user_data-google-js-all data}}' },
    ],
    firingTriggerId: [triggerId], tagFiringOption: 'ONCE_PER_PAGE',
  };
}

function mkTagSetCookies(id, triggerId) {
  const setCookieScript = (name, value) =>
    `(function(){try{var d=new Date();d.setTime(d.getTime()+400*86400000);document.cookie="${name}="+encodeURIComponent(${value})+";expires="+d.toUTCString()+";path=/;SameSite=Lax;Secure";}catch(e){}})();`;

  return {
    tagId: id, name: '[Set Cookies] User Data', type: 'html',
    parameter: [{ type: 'TEMPLATE', key: 'html', value: `<script>
${setCookieScript('LeadFirstName', "'{{user-js-firstname}}'")}
${setCookieScript('LeadLastName',  "'{{user-js-lastname}}'")}
${setCookieScript('LeadEmail',     "'{{user-js-email}}'")}
${setCookieScript('LeadPhone',     "'{{user-js-phone}}'")}
</script>` }],
    firingTriggerId: [triggerId], tagFiringOption: 'ONCE_PER_PAGE',
  };
}

// ── Helper ────────────────────────────────────────────────────
function mkParam(key, value) {
  return { type: 'MAP', map: [
    { type: 'TEMPLATE', key: 'name', value: key },
    { type: 'TEMPLATE', key: 'value', value: value },
  ]};
}
