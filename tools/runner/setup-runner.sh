#!/usr/bin/env bash
# ============================================================================
# ONE UBUNTU 24.04 SERVER AS THIS REPOSITORY'S GITHUB ACTIONS RUNNERS.
#
# Run as root on a fresh x86-64 Ubuntu 24.04 server (tools/runner/README.md):
#
#     RUNNER_TOKEN=<registration token> bash setup-runner.sh [how many runners, default 3]
#
# The token comes from
#     gh api -X POST repos/MadvillainQuas/website/actions/runners/registration-token --jq .token
# and is good for an hour. Re-running is safe: runners already configured are left alone.
#
# Why three: a live ingest pass holds one runner for up to five and a half hours,
# discovery and the nightly dataset need a second, and guard, pages and clubs a third.
# What the jobs need that GitHub's ubuntu-latest image has and a bare server does not:
# Google Chrome (discovery drives it through Selenium), the gh CLI (a live pass
# dispatches the next one), libcairo2 (crest SVGs), and a system Python with requests
# (guard's ingest tests run on it and pip-install into it).
# ============================================================================
set -euo pipefail

REPO_URL="https://github.com/MadvillainQuas/website"
COUNT="${1:-3}"
LABELS="epinoia"
: "${RUNNER_TOKEN:?set RUNNER_TOKEN to a registration token (see the header)}"

if [ "$(id -u)" -ne 0 ]; then echo "run this as root" >&2; exit 1; fi
if [ "$(uname -m)" != "x86_64" ]; then echo "needs an x86-64 server: Chrome has no Linux ARM build" >&2; exit 1; fi

export DEBIAN_FRONTEND=noninteractive

echo "== packages"
apt-get update -q
apt-get -y -q upgrade
apt-get install -y -q --no-install-recommends \
  ca-certificates curl wget git jq unzip zip tar gnupg openssh-client \
  python3 python3-pip python3-venv python-is-python3 python3-requests \
  libcairo2 nodejs build-essential libffi-dev libssl-dev \
  unattended-upgrades ufw

# gh CLI
if ! command -v gh > /dev/null; then
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /usr/share/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list
fi
# Google Chrome, at /usr/bin/google-chrome where the ingest looks for it
if ! command -v google-chrome > /dev/null; then
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor --yes -o /usr/share/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
    > /etc/apt/sources.list.d/google-chrome.list
fi
apt-get update -q
apt-get install -y -q gh google-chrome-stable

echo "== swap, security updates, firewall"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile > /dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
dpkg-reconfigure -f noninteractive unattended-upgrades
ufw allow OpenSSH > /dev/null
ufw --force enable > /dev/null

echo "== the runner account (no sudo: every job step that used sudo now checks first)"
id runner > /dev/null 2>&1 || useradd -m -s /bin/bash runner

VER="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name | sed 's/^v//')"
TGZ="/home/runner/actions-runner-linux-x64-${VER}.tar.gz"
[ -f "$TGZ" ] || curl -fsSL -o "$TGZ" "https://github.com/actions/runner/releases/download/v${VER}/actions-runner-linux-x64-${VER}.tar.gz"

for i in $(seq 1 "$COUNT"); do
  d="/home/runner/actions-runner-$i"
  if [ -f "$d/.runner" ]; then echo "== runner $i is already configured"; continue; fi
  echo "== runner $i"
  mkdir -p "$d"
  tar xzf "$TGZ" -C "$d"
  "$d/bin/installdependencies.sh" > /dev/null
  # Ubuntu 24.04 refuses pip installs into the system Python unless told otherwise, and
  # guard's ingest tests pip-install requests into it, as they do on GitHub's image.
  printf 'LANG=C.UTF-8\nPIP_BREAK_SYSTEM_PACKAGES=1\n' > "$d/.env"
  chown -R runner:runner "$d"
  sudo -u runner "$d/config.sh" --unattended --replace \
    --url "$REPO_URL" --token "$RUNNER_TOKEN" \
    --name "$(hostname)-$i" --labels "$LABELS" --work _work
  (cd "$d" && ./svc.sh install runner > /dev/null && ./svc.sh start > /dev/null)
done

echo
echo "Done: ${COUNT} runner(s) labelled '${LABELS}'. They show as Idle under the repository's"
echo "Settings > Actions > Runners. Jobs move to them when the repository variable RUNS_ON is"
echo '["self-hosted","linux","epinoia"].'
