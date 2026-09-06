# ============================================================================
# setup-scraper.ps1 — put the WHOLE scraper pipeline where the ingest worker
# can use it, so nothing is missed on GitHub's runners (stints, lineups,
# every league scraper, the 13-CSV dataset build).
#
#   powershell -ExecutionPolicy Bypass -File scripts\ingest\setup-scraper.ps1
#
# What it does (safe to re-run; re-running pushes your latest scraper edits):
#   1. turns C:\Users\Admin\Documents\scraper files into a PRIVATE GitHub repo
#      (MadvillainQuas/scraper-pipeline). Everything is included except
#      caches, node_modules, the 6 GB output folder, *.bak* backups and the
#      local users.json (credentials).
#   2. creates a deploy key for that repo (read-only) and stores the private
#      half as the website repo's SCRAPER_DEPLOY_KEY secret + sets the
#      SCRAPER_REPO variable — exactly what .github/workflows/ingest.yml
#      already looks for.
#   3. runs the ingest workflow once so you can see "stints" become non-zero.
# ============================================================================
$ErrorActionPreference = 'Continue'
$site   = 'MadvillainQuas/website'
$repo   = 'MadvillainQuas/scraper-pipeline'
$src    = 'C:\Users\Admin\Documents\scraper files'
$keyDir = Join-Path $env:USERPROFILE '.ssh'
$key    = Join-Path $keyDir 'scraper-pipeline-deploy'
function Say($m) { Write-Host "`n== $m" -ForegroundColor Cyan }

# gh installed in this session is not on PATH until a new terminal opens — look in its standard home too
$ghHome = 'C:\Program Files\GitHub CLI'
if (-not (Get-Command gh -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $ghHome 'gh.exe'))) { $env:PATH = "$ghHome;" + $env:PATH }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "GitHub CLI not found - run setup-github.ps1 first" }
$env:GH_TOKEN = $null; $env:GITHUB_TOKEN = $null
gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { gh auth login --hostname github.com --git-protocol https --web --scopes "repo,workflow,admin:public_key" }

# 1. the scraper as a private repo
Say "scraper folder -> private repo $repo"
Set-Location $src
if (-not (Test-Path '.gitignore')) {
@"
# generated / heavy / secret — never in the repo
__pycache__/
*.pyc
node_modules/
output/
*.bak*
*.log
users.json
.env
scraped_data/
"@ | Set-Content -Encoding utf8 .gitignore
}
if (-not (Test-Path '.git')) { git init -q; git branch -M main }
# commits need an identity; reuse the website repo's, else a noreply one
$siteName = git -C (Split-Path $PSScriptRoot -Parent | Split-Path -Parent) config user.name
$siteMail = git -C (Split-Path $PSScriptRoot -Parent | Split-Path -Parent) config user.email
if (-not (git config user.name))  { git config user.name  ($(if ($siteName) { $siteName } else { 'MadvillainQuas' })) }
if (-not (git config user.email)) { git config user.email ($(if ($siteMail) { $siteMail } else { 'MadvillainQuas@users.noreply.github.com' })) }
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -q -m "scraper pipeline: $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
gh repo view $repo 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  gh repo create $repo --private --source . --remote origin --push
} else {
  if (-not (git remote get-url origin 2>$null)) { git remote add origin "https://github.com/$repo.git" }
  git push -u origin main
}
if ($LASTEXITCODE -ne 0) { throw "push to $repo failed" }

# 2. deploy key (read-only) -> website secret + variable
Say "deploy key for the workflow"
if (-not (Test-Path $keyDir)) { New-Item -ItemType Directory $keyDir | Out-Null }
if (-not (Test-Path $key)) { ssh-keygen -t ed25519 -N '""' -C 'ingest-workflow' -f $key | Out-Null }
gh repo deploy-key add "$key.pub" --repo $repo --title "website ingest workflow" 2>&1 | Out-Null
Get-Content $key -Raw | gh secret set SCRAPER_DEPLOY_KEY --repo $site
if ($LASTEXITCODE -ne 0) { throw "could not store SCRAPER_DEPLOY_KEY" }
gh variable set SCRAPER_REPO --repo $site --body $repo
Write-Host "SCRAPER_REPO = $repo, SCRAPER_DEPLOY_KEY stored"

# 3. prove it
Say "running the ingest workflow"
gh workflow run ingest.yml --repo $site -f source=SLB
Start-Sleep -Seconds 5
gh run list --repo $site --workflow ingest.yml --limit 1
Write-Host "`nDone. In the run log, games should now read '(final, N stints)' with N > 0." -ForegroundColor Green
