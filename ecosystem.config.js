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
      name: 'orchestration',
      script: '-m',
      args: 'scb_orchestration.server',
      interpreter: 'none',
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
