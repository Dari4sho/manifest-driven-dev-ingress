param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("sync", "clear")]
  [string]$Action,

  [string]$HostsPath = "$env:WINDIR\System32\drivers\etc\hosts",
  [string]$IngressHostsFile = ""
)

$ErrorActionPreference = "Stop"
$markerStart = "# IngressctlHostsSectionStart"
$markerEnd = "# IngressctlHostsSectionEnd"

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Ensure-Admin {
  if (Test-IsAdmin) { return }
  $argList = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$PSCommandPath`"",
    "-Action", $Action,
    "-HostsPath", "`"$HostsPath`""
  )
  if ($IngressHostsFile) {
    $argList += @("-IngressHostsFile", "`"$IngressHostsFile`"")
  }
  Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList ($argList -join " ")
  exit 0
}

function Read-Content([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "File not found: $Path"
  }
  return [System.IO.File]::ReadAllText($Path)
}

function Write-ContentNoBom([string]$Path, [string]$Value) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $utf8NoBom)
}

function Get-ManagedHosts([string]$Path) {
  if (-not $Path) { return @() }
  $raw = Read-Content $Path
  $hosts = New-Object System.Collections.Generic.HashSet[string]
  foreach ($line in ($raw -split "`r?`n")) {
    $t = $line.Trim()
    if (-not $t) { continue }
    if ($t.StartsWith("#")) { continue }
    if ($t.StartsWith("127.0.0.1") -or $t.StartsWith("::1")) {
      $parts = $t -split "\s+"
      if ($parts.Count -lt 2) { continue }
      for ($i = 1; $i -lt $parts.Count; $i++) {
        $h = $parts[$i].Trim().ToLowerInvariant()
        if (-not $h) { continue }
        [void]$hosts.Add($h)
      }
    }
  }
  return @($hosts) | Sort-Object
}

function Build-Section([string[]]$Hosts) {
  $lines = @(
    $markerStart,
    "# Managed by ingressctl. Do not edit manually."
  )
  foreach ($h in $Hosts) {
    $lines += "127.0.0.1 $h"
  }
  $lines += $markerEnd
  return ($lines -join "`n")
}

function Replace-Or-Append-Section([string]$Original, [string]$Section) {
  $content = $Original
  if (-not $content.EndsWith("`n")) {
    $content += "`n"
  }
  $start = $content.IndexOf($markerStart, [System.StringComparison]::Ordinal)
  $end = $content.IndexOf($markerEnd, [System.StringComparison]::Ordinal)
  if ($start -ge 0 -and $end -gt $start) {
    $afterEnd = $end + $markerEnd.Length
    $before = $content.Substring(0, $start).TrimEnd("`r", "`n")
    $after = $content.Substring($afterEnd).TrimStart("`r", "`n")
    return "$before`n$Section`n$after"
  }
  return "$content`n$Section`n"
}

function Remove-Section([string]$Original) {
  $content = $Original
  $start = $content.IndexOf($markerStart, [System.StringComparison]::Ordinal)
  $end = $content.IndexOf($markerEnd, [System.StringComparison]::Ordinal)
  if ($start -lt 0 -or $end -le $start) {
    return $content
  }
  $afterEnd = $end + $markerEnd.Length
  $before = $content.Substring(0, $start).TrimEnd("`r", "`n")
  $after = $content.Substring($afterEnd).TrimStart("`r", "`n")
  return "$before`n$after"
}

Ensure-Admin

$hostsContent = Read-Content $HostsPath
if ($Action -eq "sync") {
  if (-not $IngressHostsFile) {
    throw "IngressHostsFile is required for action=sync"
  }
  $managedHosts = Get-ManagedHosts $IngressHostsFile
  $section = Build-Section $managedHosts
  $next = Replace-Or-Append-Section $hostsContent $section
  Write-ContentNoBom $HostsPath $next
  Write-Output "Windows hosts synced: $HostsPath (hosts=$($managedHosts.Count))"
} else {
  $next = Remove-Section $hostsContent
  Write-ContentNoBom $HostsPath $next
  Write-Output "Windows hosts section cleared: $HostsPath"
}
