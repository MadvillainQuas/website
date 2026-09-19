# Epinoia live lane, started at logon and otherwise invisible.
#
# WHAT IT DOES. Keeps the live lane (run_ingest.py --live-only) available for the whole time the
# PC is on, without a window sitting open all day:
#
#   * NOTHING NEAR   -> it sleeps, hidden, for exactly as long as the lane itself says (the lane
#                       writes %TEMP%\epinoia_live_wait: seconds until 30 minutes before the next
#                       tip-off, capped at 4 h).
#   * A GAME IS LIVE, OR TIPS WITHIN 30 MIN -> it opens a normal console window running the lane,
#                       so you can see it work, and closes it again when the lane stops.
#
# HOW IT KNOWS. Each cycle it runs a one-second PROBE of the lane, hidden. The probe reads the
# schedule once, prints what is due, leaves the wait file, and exits. A wait of 30 s or less is
# the lane's own word for "there is work now"; anything longer is how long there is nothing to do.
#
# ONE LANE ONLY. run_ingest.py takes a named mutex, and a second lane exits at once (two lanes
# writing the same games 15 s apart made the site flash between real and zero clocks). So if a lane
# is already running - one you started by hand from live_lane.bat, say - the probe exits without
# leaving a wait file, and this waits a minute and looks again instead of starting a rival.
#
# This script's own single-instance guard is separate: logging on twice must not start two of it.
#
# Install once (Command Prompt):   see install_live_lane.cmd
# Log:                             %LOCALAPPDATA%\epinoia\live_lane.log

$ErrorActionPreference = 'Continue'
$Here     = Split-Path -Parent $MyInvocation.MyCommand.Path
$WaitFile = Join-Path $env:TEMP 'epinoia_live_wait'
$LogDir   = Join-Path $env:LOCALAPPDATA 'epinoia'
$Log      = Join-Path $LogDir 'live_lane.log'
$Near     = 30      # the lane's own "work now" answer, run_ingest.LIVE_RESTART
$Args_    = '-u run_ingest.py --worker-config --live-only --live-every 15 --feed-out ""'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# --- one supervisor per login -------------------------------------------------------------
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Global\EpinoiaLiveLaneSupervisor', [ref]$created)
if (-not $created) { exit 0 }

function Say($m) {
    $line = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $m
    Add-Content -Path $Log -Value $line
    # keep the log from growing for ever: trim to the last ~2000 lines when it passes 1 MB
    if ((Get-Item $Log).Length -gt 1MB) {
        Get-Content $Log -Tail 2000 | Set-Content "$Log.tmp"; Move-Item -Force "$Log.tmp" $Log
    }
}

function Read-Wait {
    if (Test-Path $WaitFile) {
        $t = (Get-Content $WaitFile -ErrorAction SilentlyContinue | Select-Object -First 1)
        $n = 0
        if ([int]::TryParse(("$t").Trim(), [ref]$n)) { return $n }
    }
    return $null
}

Say "supervisor started (pid $PID) in $Here"

while ($true) {
    if (Test-Path $WaitFile) { Remove-Item $WaitFile -Force -ErrorAction SilentlyContinue }

    # PROBE: one read of the schedule, hidden. --live-loop 1 = a single pass, no napping.
    $probeOut = Join-Path $LogDir 'probe.out'
    try {
        Start-Process -FilePath 'python' -WorkingDirectory $Here -WindowStyle Hidden -Wait `
            -ArgumentList ($Args_ + ' --live-loop 1') `
            -RedirectStandardOutput $probeOut -RedirectStandardError (Join-Path $LogDir 'probe.err')
    } catch {
        Say "probe could not start python: $($_.Exception.Message) - retrying in 5 min"
        Start-Sleep -Seconds 300
        continue
    }

    $wait = Read-Wait
    if ($null -eq $wait) {
        # no answer: another lane holds the mutex, or the probe failed before finishing
        Say 'no wait file after the probe (another lane running, or the probe failed) - looking again in 60 s'
        Start-Sleep -Seconds 60
        continue
    }

    if ($wait -le $Near) {
        # WORK NOW - open a window you can see, and let the lane run until it has nothing near
        Say 'a game is live or about to tip - opening the lane window'
        $cmd = 'title Epinoia live lane (games on) && python ' + $Args_ + ' --live-loop 21600'
        Start-Process -FilePath 'cmd.exe' -WorkingDirectory $Here -WindowStyle Normal -Wait `
            -ArgumentList @('/c', $cmd)
        Say 'lane window closed (nothing live or near) - probing again'
        Start-Sleep -Seconds 30
    } else {
        $h = [math]::Floor($wait / 3600); $m = [math]::Floor(($wait % 3600) / 60)
        Say ("nothing near - sleeping {0}h {1:00}m until 30 min before the next tip-off" -f $h, $m)
        Start-Sleep -Seconds $wait
    }
}
