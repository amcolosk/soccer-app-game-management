# Loads environment variables from .env.local into the current PowerShell session
$envFile = Join-Path $PSScriptRoot ".env.local"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^[\s]*([^#][^=]*)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [System.Environment]::SetEnvironmentVariable($name, $value, 'Process')
            Write-Host "Set $name=$value"
        }
    }
    Write-Host "Loaded environment variables from .env.local."
} else {
    Write-Host ".env.local file not found."
}