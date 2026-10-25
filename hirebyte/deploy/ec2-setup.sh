#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 EC2 instance for the HireByte demo:
# Docker + Compose, and 2 GB of swap so the image builds never run out of memory.
#
#   sudo bash deploy/ec2-setup.sh
set -euo pipefail

apt-get update
apt-get install -y docker.io docker-compose-v2 git
# Optional: without buildx, Compose falls back to the classic builder, which works for these images.
apt-get install -y docker-buildx || echo "docker-buildx not available; continuing with the classic builder."
systemctl enable --now docker

if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

docker --version
docker compose version
echo "EC2 setup finished."
