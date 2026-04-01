$rawInput = [Console]::In.ReadToEnd()

function Write-Decision {
    param(
        [ValidateSet('allow', 'ask', 'deny')]
        [string]$Decision,
        [string]$Reason
    )

    $output = @{
        hookSpecificOutput = @{
            hookEventName = 'PreToolUse'
            permissionDecision = $Decision
            permissionDecisionReason = $Reason
        }
    }

    $output | ConvertTo-Json -Compress
}

if ([string]::IsNullOrWhiteSpace($rawInput)) {
    Write-Decision -Decision 'ask' -Reason 'Hook payload missing from stdin.'
    exit 0
}

try {
    $payload = $rawInput | ConvertFrom-Json -Depth 20
} catch {
    Write-Decision -Decision 'ask' -Reason 'Hook payload is not valid JSON.'
    exit 0
}

function Get-PropValue {
    param(
        [object]$Obj,
        [string[]]$Names
    )

    if ($null -eq $Obj) {
        return $null
    }

    foreach ($name in $Names) {
        $prop = $Obj.PSObject.Properties[$name]
        if ($null -ne $prop -and $null -ne $prop.Value) {
            return $prop.Value
        }
    }

    return $null
}

$toolName = Get-PropValue -Obj $payload -Names @('toolName', 'tool_name', 'tool', 'name')
if (-not $toolName) {
    $toolObject = Get-PropValue -Obj $payload -Names @('tool')
    if ($toolObject -is [pscustomobject] -or $toolObject -is [hashtable]) {
        $toolName = Get-PropValue -Obj $toolObject -Names @('name', 'toolName', 'tool_name')
    }
}

if (-not ($toolName -match 'terminal|run_in_terminal')) {
    Write-Decision -Decision 'ask' -Reason 'Non-terminal tool; approval decision deferred.'
    exit 0
}

$toolInput = Get-PropValue -Obj $payload -Names @('toolInput', 'input', 'arguments', 'args')
$command = $null
if ($toolInput -is [string]) {
    $command = $toolInput
} elseif ($toolInput -is [pscustomobject] -or $toolInput -is [hashtable]) {
    $command = Get-PropValue -Obj $toolInput -Names @('command', 'cmd', 'text')
}

if ([string]::IsNullOrWhiteSpace($command)) {
    $command = Get-PropValue -Obj $payload -Names @('command')
}

if ([string]::IsNullOrWhiteSpace($command)) {
    Write-Decision -Decision 'ask' -Reason 'Terminal command is missing from hook payload.'
    exit 0
}

# Deny known destructive commands first.
$denyPatterns = @(
    '(?i)(^|[\s;|])rm\s+-rf\b',
    '(?i)(^|[\s;|])del\s+/[sqf].*',
    '(?i)\bremove-item\b.*\b(-recurse|-force)\b',
    '(?i)\bgit\s+reset\s+--hard\b',
    '(?i)\bgit\s+checkout\s+--\b',
    '(?i)\bgit\s+clean\s+-[fdx]+\b',
    '(?i)\bformat-(volume|disk)\b',
    '(?i)\bdrop\s+database\b'
)

foreach ($pattern in $denyPatterns) {
    if ($command -match $pattern) {
        Write-Decision -Decision 'deny' -Reason 'Command matched destructive denylist pattern.'
        exit 0
    }
}

$allowPatterns = @(
    '(?i)^\s*git\s+status(\s|$)',
    '(?i)^\s*git\s+diff(\s|$)',
    '(?i)^\s*git\s+show(\s|$)',
    '(?i)^\s*git\s+log(\s|$)',
    '(?i)^\s*git\s+branch(\s|$)',
    '(?i)^\s*rg(\s|$)',
    '(?i)^\s*(ls|dir|get-childitem)(\s|$)',
    '(?i)^\s*npm\s+run\s+test(:run)?\s+--\s+.+$',
    '(?i)^\s*npx\s+vitest\s+(run\s+)?[^\r\n]*$'
)

foreach ($pattern in $allowPatterns) {
    if ($command -match $pattern) {
        Write-Decision -Decision 'allow' -Reason 'Read-only command matched pre-approved allowlist.'
        exit 0
    }
}

Write-Decision -Decision 'ask' -Reason 'Command did not match allowlist; explicit approval required.'
exit 0
