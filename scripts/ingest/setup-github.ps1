# ============================================================================
# setup-github.ps1 — steps 2 + 3 of "switching the league feed on", in one go.
#
#   powershell -ExecutionPolicy Bypass -File scripts\ingest\setup-github.ps1
#
# What it does (each step is skipped if already done):
#   1. installs the GitHub CLI (winget) if it is missing
#   2. signs you in to GitHub in the browser and wires git to use that login
#      (this is also what un-blocks `git push` from this machine)
#   3. asks for the two Supabase values and stores them as repo secrets
#      (nothing is echoed back or written to disk)
#   4. commits + pushes the ingest work (which is what enables the workflow)
#   5. runs the workflow once for SLB and opens the Actions page
#
# The Supabase values live at
#   https://supabase.com/dashboard/project/hhvofgqqadtyvcjudhjx/settings/api
#   Project URL          -> SUPABASE_URL          (https://hhvofgqqadtyvcjudhjx.supabase.co)
#   service_role secret  -> SUPABASE_SERVICE_KEY  (the SECRET one, not anon)
# ============================================================================
$ErrorActionPreference = 'Continue'   # native commands write to stderr freely; exit codes are checked by hand
$repo = 'MadvillainQuas/website'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root

function Say($m) { Write-Host "`n== $m" -ForegroundColor Cyan }

# 1. GitHub CLI
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Say "installing GitHub CLI (winget)"
  winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements
  $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('PATH', 'User')
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "gh still not on PATH - open a new terminal and run this script again" }
}

# 2. sign in + git credentials
# A personal access token in the environment (GH_TOKEN / GITHUB_TOKEN) overrides any login and
# usually cannot manage Actions secrets - drop it for this session so the browser login is used.
$env:GH_TOKEN = $null; $env:GITHUB_TOKEN = $null
gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Say "signing in to GitHub (a browser window opens)"
  gh auth login --hostname github.com --git-protocol https --web --scopes "repo,workflow"
}
# Probe: can this login manage secrets? A token login (PAT) without the secrets permission gets 403.
$probe = gh secret list --repo $repo 2>&1
if ($LASTEXITCODE -ne 0) {
  Say "the current GitHub login cannot manage repo secrets ($($probe | Select-Object -First 1)) - switching to a browser login"
  gh auth logout --hostname github.com 2>&1 | Out-Null
  gh auth login --hostname github.com --git-protocol https --web --scopes "repo,workflow"
  $probe = gh secret list --repo $repo 2>&1
  if ($LASTEXITCODE -ne 0) { throw "still cannot manage secrets: $probe" }
}
gh auth setup-git 2>&1 | Out-Null

# 3. secrets
Say "Supabase secrets for the ingest worker"
$existing = $probe
if ($existing -match 'SUPABASE_SERVICE_KEY') {
  $redo = Read-Host "SUPABASE_URL / SUPABASE_SERVICE_KEY already set. Replace them? (y/N)"
} else { $redo = 'y' }
if ($redo -match '^[Yy]') {
  $url = Read-Host "SUPABASE_URL [https://hhvofgqqadtyvcjudhjx.supabase.co]"
  if (-not $url) { $url = 'https://hhvofgqqadtyvcjudhjx.supabase.co' }
  $sec = Read-Host "SUPABASE_SERVICE_KEY (service_role secret, input hidden)" -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  if (-not $plain) { throw "no key entered" }
  $url   | gh secret set SUPABASE_URL         --repo $repo
  if ($LASTEXITCODE -ne 0) { throw "could not store SUPABASE_URL" }
  $plain | gh secret set SUPABASE_SERVICE_KEY --repo $repo
  if ($LASTEXITCODE -ne 0) { throw "could not store SUPABASE_SERVICE_KEY" }
  $plain = $null
  Write-Host "secrets stored"
}

# 4. commit + push (this is what turns the workflow on)
Say "committing the ingest work"
git add -A -- .github/workflows/ingest.yml config/ingest-sources.json scripts/ingest docs supabase/migrations data/feed data/ingest-fixtures .gitignore index_9.html
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -m "League feed: ingest worker, Supabase registry, index_9 feed loader" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
} else { Write-Host "nothing new to commit" }
git push origin HEAD
if ($LASTEXITCODE -ne 0) { throw "git push failed - see above" }

# 5. first run
Say "running the ingest workflow once for SLB"
gh workflow run ingest.yml --repo $repo -f source=SLB
Start-Sleep -Seconds 3
gh run list --repo $repo --workflow ingest.yml --limit 1
Start-Process "https://github.com/$repo/actions/workflows/ingest.yml"
Write-Host "`nDone. Watch the run in the browser; the feed lands in data/feed/ and in Supabase on success." -ForegroundColor Green
