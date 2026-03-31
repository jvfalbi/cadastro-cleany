# Envia arquivos críticos para a EC2 e lembra de reiniciar o PM2.
# Uso (PowerShell, na raiz do projeto):
#   .\scripts\upload-to-ec2.ps1
# Ou com parâmetros:
#   .\scripts\upload-to-ec2.ps1 -Pem "C:\Users\...\chave.pem" -RemoteHost "ec2-user@1.2.3.4"

param(
  [Parameter(Mandatory = $false)]
  [string] $Pem = "",
  [Parameter(Mandatory = $false)]
  [string] $RemoteHost = "",
  [Parameter(Mandatory = $false)]
  [string] $RemoteDir = "~/cadastro-cleany"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")

if (-not $Pem) {
  $Pem = Read-Host "Caminho completo do arquivo .pem"
}
if (-not $RemoteHost) {
  $RemoteHost = Read-Host "Destino SSH (ex: ec2-user@13.59.155.241)"
}

$files = @(
  @{ Local = "src\server.js"; Remote = "src/server.js" },
  @{ Local = "ecosystem.config.cjs"; Remote = "ecosystem.config.cjs" },
  @{ Local = "package.json"; Remote = "package.json" }
)

foreach ($f in $files) {
  $localPath = Join-Path $root $f.Local
  if (-not (Test-Path $localPath)) {
    Write-Warning "Pulando (não encontrado): $localPath"
    continue
  }
  $dest = "$RemoteHost`:$RemoteDir/$($f.Remote)"
  Write-Host ">> scp $localPath -> $dest"
  scp -i $Pem $localPath $dest
}

Write-Host ""
Write-Host "Próximo passo na EC2 (SSH):" -ForegroundColor Cyan
Write-Host "  cd $RemoteDir && npm install --omit=dev && pm2 restart cadastro-cleany && pm2 logs cadastro-cleany --lines 12"
