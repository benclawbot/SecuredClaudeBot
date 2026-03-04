#!/bin/bash
# Gateway process manager

GATEWAY_DIR="/home/tom/FastBot/packages/gateway"

restart_gateway() {
    echo "Stopping gateway..."
    pkill -f "tsx.*gateway" 2>/dev/null
    sleep 1
    echo "Starting gateway..."
    cd "$GATEWAY_DIR"
    pnpm run dev &
    echo "Gateway started with PID $!"
}

# Handle the restart command
if [ "$1" = "restart" ]; then
    restart_gateway
fi

# Initial start if no arguments
cd "$GATEWAY_DIR"
pnpm run dev
