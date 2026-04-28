export default {
  apps: [
    {
      name: 'konverta',
      script: 'server.js',
      instances: 1,           // 1 instância — não vai conflitar com outros apps
      exec_mode: 'fork',
      interpreter: 'node',
      interpreter_args: '--experimental-vm-modules',

      // Variáveis de ambiente — são lidas do .env pelo dotenv
      env_production: {
        NODE_ENV: 'production',
      },

      // Reinicia automaticamente em caso de crash
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',

      // Logs separados — não mistura com outros apps
      out_file: '/var/log/konverta/out.log',
      error_file: '/var/log/konverta/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
