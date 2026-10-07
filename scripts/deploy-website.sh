#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$project_root/website/dist"
host="${WEBSITE_SSH_HOST:-121.43.135.1}"
user="${WEBSITE_SSH_USER:-website-deploy}"
key="${WEBSITE_SSH_KEY:-$HOME/.ssh/community_ai_website_deploy}"
remote_rsync="${WEBSITE_REMOTE_RSYNC:-C:/msys64/usr/bin/rsync.exe}"
remote_dir="/c/community-ai/website/dist/"

if [[ ! -d "$source_dir" || ! -f "$source_dir/index.html" ]]; then
  echo "找不到 website/dist/index.html，停止部署。" >&2
  exit 1
fi
if [[ -z "$user" || -z "$key" || ! -f "$key" ]]; then
  echo "找不到官网部署 SSH 私钥：$key。" >&2
  exit 1
fi

ssh_command="ssh -i $key -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10"

# 只同步官网静态目录；保留服务器目录中不属于本项目的现有文件。
rsync -rltz --checksum --itemize-changes \
  --exclude '.DS_Store' \
  --exclude '._*' \
  -e "$ssh_command" \
  --rsync-path="$remote_rsync" \
  "$source_dir/" "$user@$host:$remote_dir"

echo "官网静态文件同步完成。"
