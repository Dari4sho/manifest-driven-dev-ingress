param(
  [Parameter(Mandatory = $true)]
  [string]$RootCAPath
)

if (-not (Test-Path -LiteralPath $RootCAPath)) {
  throw "Root CA file not found: $RootCAPath"
}

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($RootCAPath)
$thumb = $cert.Thumbprint
$existing = Get-ChildItem -Path Cert:\CurrentUser\Root | Where-Object { $_.Thumbprint -eq $thumb }

if ($null -eq $existing) {
  Import-Certificate -FilePath $RootCAPath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
  Write-Output "Windows trust imported (CurrentUser\\Root): $thumb"
} else {
  Write-Output "Windows trust already present (CurrentUser\\Root): $thumb"
}
