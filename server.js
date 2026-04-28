import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';

import { collectRoute }  from './src/routes/collect.js';
import { scriptRoute }   from './src/routes/script.js';
import { adminRoutes }   from './src/routes/admin/index.js';
import { webhookRoutes } from './src/routes/webhook/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3001', 10);
const isDev = process.env.NODE_ENV !== 'production';

const fastify = Fastify({
  logger: {
    level: isDev ? 'info' : 'warn',
    transport: isDev ? { target: 'pino-pretty' } : undefined,
  },
  trustProxy: true, // necessário para pegar o IP real atrás do Nginx
});

// ── CORS ────────────────────────────────────────────────────
// /collect aceita origens de domínios verificados (validado na rota)
// /c/*.js precisa de acesso aberto (é um script estático)
// /admin e /dash são protegidos por chave
await fastify.register(cors, {
  origin: (origin, cb) => {
    // Permite tudo — a validação de domínio é feita dentro de /collect
    // Scripts JS precisam ser acessíveis de qualquer origem
    cb(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});

// ── Arquivos estáticos do painel ──────────────────────────────
await fastify.register(staticFiles, {
  root: join(__dirname, 'public'),
  prefix: '/',
  decorateReply: false,
});

// ── Auth hook para rotas /admin ───────────────────────────────
fastify.addHook('preHandler', async (req, reply) => {
  const path = req.url.split('?')[0];

  if (path.startsWith('/api/admin') || path === '/admin' || path === '/admin.html') {
    const key = req.headers['x-admin-key'] || req.query.key;
    if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  }

  if (path.startsWith('/dash')) {
    const key = req.headers['x-dash-key'] || req.query.key;
    if (!process.env.DASH_KEY || key !== process.env.DASH_KEY) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  }
});

// ── Rotas ─────────────────────────────────────────────────────
await fastify.register(collectRoute);
await fastify.register(scriptRoute);
await fastify.register(adminRoutes);
await fastify.register(webhookRoutes);

// ── Health check ──────────────────────────────────────────────
fastify.get('/health', async () => ({ ok: true, ts: Date.now() }));

// ── Admin panel redirect ──────────────────────────────────────
fastify.get('/admin', async (req, reply) => {
  const key = req.query.key || '';
  return reply.redirect(`/admin.html?key=${key}`);
});

// ── Start ──────────────────────────────────────────────────────
try {
  await fastify.listen({ port: PORT, host: '127.0.0.1' });
  console.log(`\n🚀 Konverta rodando na porta ${PORT}`);
  console.log(`   Admin: https://${process.env.PLATFORM_DOMAIN}/admin?key=SUA_ADMIN_KEY\n`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
