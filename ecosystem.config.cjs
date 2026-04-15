/** PM2: pm2 start ecosystem.config.cjs */
module.exports = {
  apps: [
    {
      name: 'cadastro-cleany',
      script: 'src/server.js',
      cwd: __dirname,
      // SQLite: use só 1 instância (várias processos no mesmo .sqlite corrompe / perde dados).
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // Descomente e aponte para pasta persistente (evita banco novo a cada deploy):
        // DATA_DIR: '/var/lib/cleany-data',
      },
      // Credenciais: arquivo .env na raiz (carregado pelo dotenv em src/server.js)
    },
  ],
};
