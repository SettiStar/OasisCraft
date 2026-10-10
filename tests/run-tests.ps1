# Runs OasisCraft's automated tests in headless Chrome and prints PASS / FAIL lines.
#
#   powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1
#   powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1 -Only "equip,bags"   # tests whose names contain these
#   powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1 -Shot                 # also save tests\last-run.png
#
# Builds tests\test.html from index.html (same CSP), loads tests\tests.js before the game,
# and exits with code 1 if anything failed. Uses a throwaway browser profile, so your own
# saved worlds and settings are never touched.
param(
  [string]$Only = "",
  [switch]$Shot,
  [string]$Seed = "test",
  [string]$Chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = Split-Path $here -Parent
$utf8 = New-Object System.Text.UTF8Encoding $false

if (-not (Test-Path $Chrome)) { Write-Host "Chrome not found at $Chrome (pass -Chrome <path>)"; exit 2 }

# test.html = index.html with paths pointing one folder up and the tests loaded right after
# config.js (they switch on creative mode and the dev tools for themselves).
$html = [System.IO.File]::ReadAllText("$root\index.html", $utf8)
$html = $html.Replace('src="js/', 'src="../js/').Replace('src="config.js"', 'src="../config.js"').Replace('href="css/', 'href="../css/')
$html = $html.Replace('<script src="../js/settings.js">', "<script src=`"tests.js`"></script>`n  <script src=`"../js/settings.js`">")
if (-not $html.Contains('src="tests.js"')) { Write-Host "Couldn't insert tests.js into the page (index.html script tags changed?)"; exit 2 }
[System.IO.File]::WriteAllText("$here\test.html", $html, $utf8)

$prof = Join-Path $env:TEMP "oasiscraft-test-profile"
$log = Join-Path $env:TEMP "oasiscraft-test-log.txt"
$png = if ($Shot) { "$here\last-run.png" } else { Join-Path $env:TEMP "oasiscraft-test.png" }
Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $log -Force -ErrorAction SilentlyContinue

$url = "file:///" + ($here -replace '\\', '/') + "/test.html?seed=$Seed#" + [uri]::EscapeDataString($Only)
$chromeArgs = @("--headless=new", "--disable-gpu", "--no-first-run", "--user-data-dir=$prof", "--enable-logging=stderr", "--v=0",
  "--window-size=1280,800", "--virtual-time-budget=60000", "--screenshot=$png", $url)
$start = Get-Date
Start-Process -FilePath $Chrome -ArgumentList $chromeArgs -RedirectStandardError $log -Wait -NoNewWindow
$secs = [math]::Round(((Get-Date) - $start).TotalSeconds)

# Console lines look like:  [...:INFO:CONSOLE(12)] "TEST PASS walk", source: file:///.../tests.js (12)
$lines = Get-Content $log -Encoding UTF8 | ForEach-Object { if ($_ -match '"TEST (.*)", source:') { $Matches[1] } }
$failed = 0
foreach ($l in $lines) {
  if ($l -like 'FAIL*') { $failed++; Write-Host $l -ForegroundColor Red }
  elseif ($l -like 'PASS*') { Write-Host $l -ForegroundColor Green }
  else { Write-Host $l }
}
if (-not ($lines | Where-Object { $_ -like 'SUMMARY*' })) {
  Write-Host "Tests did not finish (page error or timeout). Errors from the log:" -ForegroundColor Red
  Get-Content $log -Encoding UTF8 | Where-Object { $_ -match 'Uncaught|ERROR:CONSOLE|Refused|TrustedHTML|TrustedScript' } | Select-Object -First 10 | ForEach-Object { Write-Host "  $_" }
  exit 1
}
Write-Host "($secs s)"
if ($Shot) { Write-Host "Screenshot: $png" }
if ($failed) { exit 1 } else { exit 0 }
