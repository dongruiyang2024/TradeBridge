param(
    [string[]]$ProcessNamePattern = @('AliWorkbench', 'AliRender', 'wwbizsrv', 'TradeManager', 'WangWang', 'DingTalk'),
    [int]$MaxDepth = 4,
    [int]$MaxControlsPerWindow = 80,
    [switch]$AllVisibleWindows
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$signature = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class Win32Probe {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
'@
Add-Type -TypeDefinition $signature

function Get-WindowTitle {
    param([IntPtr]$Handle)
    $length = [Win32Probe]::GetWindowTextLength($Handle)
    if ($length -le 0) { return '' }
    $builder = [Text.StringBuilder]::new($length + 1)
    [void][Win32Probe]::GetWindowText($Handle, $builder, $builder.Capacity)
    return $builder.ToString()
}

function Get-ControlValueSummary {
    param([System.Windows.Automation.AutomationElement]$Element)

    foreach ($patternId in @(
        [System.Windows.Automation.ValuePattern]::Pattern,
        [System.Windows.Automation.TextPattern]::Pattern,
        [System.Windows.Automation.InvokePattern]::Pattern,
        [System.Windows.Automation.SelectionItemPattern]::Pattern
    )) {
        $pattern = $null
        if ($Element.TryGetCurrentPattern($patternId, [ref]$pattern)) {
            switch ($patternId.ProgrammaticName) {
                'ValuePatternIdentifiers.Pattern' {
                    $value = $pattern.Current.Value
                    if ($value) { return "value='$value'" }
                    return 'value=<empty>'
                }
                'TextPatternIdentifiers.Pattern' {
                    $text = $pattern.DocumentRange.GetText(120).Trim()
                    if ($text) { return "text='$text'" }
                    return 'text=<empty>'
                }
                default {
                    return $patternId.ProgrammaticName.Replace('Identifiers.Pattern', '')
                }
            }
        }
    }

    return ''
}

function Walk-Element {
    param(
        [System.Windows.Automation.AutomationElement]$Element,
        [int]$Depth,
        [ref]$Count
    )

    if ($Depth -gt $MaxDepth -or $Count.Value -ge $MaxControlsPerWindow) { return }

    $name = $Element.Current.Name
    $automationId = $Element.Current.AutomationId
    $className = $Element.Current.ClassName
    $controlType = $Element.Current.ControlType.ProgrammaticName.Replace('ControlType.', '')
    $value = Get-ControlValueSummary -Element $Element
    $indent = '  ' * $Depth

    if ($name -or $automationId -or $className -or $value) {
        $Count.Value++
        '{0}- {1} name="{2}" autoId="{3}" class="{4}" {5}' -f $indent, $controlType, $name, $automationId, $className, $value
    }

    $children = $Element.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.Condition]::TrueCondition
    )

    foreach ($child in $children) {
        Walk-Element -Element $child -Depth ($Depth + 1) -Count $Count
        if ($Count.Value -ge $MaxControlsPerWindow) { break }
    }
}

$patterns = $ProcessNamePattern | ForEach-Object { [regex]::Escape($_) }
$processRegex = '(' + ($patterns -join '|') + ')'
$windows = New-Object System.Collections.Generic.List[object]

$callback = [Win32Probe+EnumWindowsProc]{
    param([IntPtr]$hWnd, [IntPtr]$lParam)

    if (-not [Win32Probe]::IsWindowVisible($hWnd)) { return $true }

    $ownerProcessId = [uint32]0
    [void][Win32Probe]::GetWindowThreadProcessId($hWnd, [ref]$ownerProcessId)
    if ($ownerProcessId -eq 0) { return $true }

    $process = Get-Process -Id $ownerProcessId -ErrorAction SilentlyContinue
    if (-not $process) { return $true }
    if (-not $AllVisibleWindows -and $process.ProcessName -notmatch $processRegex) { return $true }

    $rect = [Win32Probe+RECT]::new()
    [void][Win32Probe]::GetWindowRect($hWnd, [ref]$rect)

    $windows.Add([pscustomobject]@{
        Handle = $hWnd
        ProcessName = $process.ProcessName
        ProcessId = $ownerProcessId
        Title = Get-WindowTitle -Handle $hWnd
        Bounds = ('{0},{1},{2}x{3}' -f $rect.Left, $rect.Top, ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top))
    })

    return $true
}

[void][Win32Probe]::EnumWindows($callback, [IntPtr]::Zero)

if ($windows.Count -eq 0) {
    Write-Host 'No visible target windows found.'
    exit 2
}

foreach ($window in $windows | Sort-Object ProcessName, ProcessId) {
    Write-Host ''
    Write-Host ('WINDOW process={0} pid={1} hwnd=0x{2:X} title="{3}" bounds={4}' -f `
        $window.ProcessName, $window.ProcessId, $window.Handle.ToInt64(), $window.Title, $window.Bounds)

    try {
        $element = [System.Windows.Automation.AutomationElement]::FromHandle($window.Handle)
        if (-not $element) {
            Write-Host '  UIA: no AutomationElement from handle'
            continue
        }

        $count = 0
        Walk-Element -Element $element -Depth 0 -Count ([ref]$count)
        if ($count -eq 0) {
            Write-Host '  UIA: element exists, but no readable child metadata was exposed.'
        }
    }
    catch {
        Write-Host ('  UIA error: {0}' -f $_.Exception.Message)
    }
}
