// PM2 alternative. Isolated app names (salesos-*) so `pm2 restart all` is NEVER used on a shared host: always name apps.
//   pm2 start deploy/pm2/ecosystem.config.cjs --only salesos-api   (never `pm2 restart all` / `pm2 delete all`)
// Environment comes from the process environment / env files loaded by your deploy user; no secrets in this file.
const root = process.env.SALESOS_ROOT || '/srv/salesos/current';
module.exports = {
  apps: [
    { name: 'salesos-api', cwd: `${root}/apps/api`, script: 'dist/main.js', exec_mode: 'fork', instances: 1,
      env: { NODE_ENV: 'production', PORT: 4100 }, kill_timeout: 30000, max_memory_restart: '1G', time: true },
    { name: 'salesos-worker', cwd: `${root}/apps/worker`, script: 'dist/main.js', exec_mode: 'fork', instances: 1,
      env: { NODE_ENV: 'production', WORKER_HEALTH_PORT: 4200 }, kill_timeout: 40000, max_memory_restart: '768M', time: true },
    { name: 'salesos-web', cwd: `${root}/web-standalone`, script: 'apps/web/server.js', exec_mode: 'fork', instances: 1,
      env: { NODE_ENV: 'production', PORT: 3100, HOSTNAME: '127.0.0.1' }, kill_timeout: 10000, max_memory_restart: '512M', time: true },
  ],
};
