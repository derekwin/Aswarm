#!/bin/bash
# AgentSwarm — start Next.js + Python worker
cd "$(dirname "$0")"
echo "Building..."
npm run build
echo "Starting..."
tmux kill-session -t agentswarm 2>/dev/null
tmux new-session -d -s agentswarm -c "$PWD" "npm start"
tmux split-window -h -t agentswarm -c "$PWD" "npm run worker"
tmux select-layout -t agentswarm even-horizontal
echo "Ready: http://localhost:8000"
echo "tmux attach -t agentswarm to view logs"
