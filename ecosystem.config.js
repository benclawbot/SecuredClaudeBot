module.exports = {
  apps: [
    {
      name: 'gateway',
      script: './packages/gateway/dist/index.js',
      watch: false,
      cwd: '.',
      env: {
        NODE_ENV: 'production'
      },
      autorestart: true,
      max_restarts: 10,
      min_uptime: 5000,
      exp_backoff_restart_delay: 1000
    },
    {
      name: 'dashboard',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      cwd: './packages/dashboard',
      env: {
        NODE_ENV: 'production',
        PORT: '3100'
      },
      interpreter: 'none',
      autorestart: true,
      max_restarts: 10,
      min_uptime: 5000,
      exp_backoff_restart_delay: 1000
    },
    {
      name: 'orchestration',
      script: 'python3',
      args: '-m scb_orchestration.server',
      cwd: './packages/orchestration',
      env: {
        PYTHONPATH: 'src'
      },
      autorestart: true,
      max_restarts: 10,
      min_uptime: 5000,
      exp_backoff_restart_delay: 1000,
      wait_ready: false
    }
  ]
}
