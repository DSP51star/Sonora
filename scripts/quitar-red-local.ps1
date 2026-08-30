#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3000
)

$ruleName = "Sonora Local (TCP $Port)"
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

if ($null -eq $existingRule) {
    Write-Host "No existe la regla '$ruleName'."
    exit 0
}

$existingRule | Remove-NetFirewallRule
Write-Host "Regla '$ruleName' eliminada." -ForegroundColor Green
