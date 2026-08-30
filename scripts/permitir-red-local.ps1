#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3000
)

$ruleName = "Sonora Local (TCP $Port)"
$nodeCommand = Get-Command node.exe -ErrorAction Stop
$nodePath = $nodeCommand.Source
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

if ($null -eq $existingRule) {
    New-NetFirewallRule `
        -DisplayName $ruleName `
        -Description "Permite Sonora únicamente desde la subred local de confianza." `
        -Direction Inbound `
        -Action Allow `
        -Enabled True `
        -Profile Private `
        -Program $nodePath `
        -Protocol TCP `
        -LocalPort $Port `
        -RemoteAddress LocalSubnet | Out-Null
} else {
    $existingRule | Set-NetFirewallRule -Direction Inbound -Action Allow -Enabled True -Profile Private
    $existingRule | Get-NetFirewallApplicationFilter | Set-NetFirewallApplicationFilter -Program $nodePath
    $existingRule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $Port
    $existingRule | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress LocalSubnet
}

Write-Host "Regla '$ruleName' activa para redes privadas y equipos de la subred local." -ForegroundColor Green
Write-Host "Programa permitido: $nodePath"
Write-Host "No se ha abierto el puerto a Internet ni en perfiles de red pública."
