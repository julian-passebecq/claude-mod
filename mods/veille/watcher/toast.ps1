# veille - one Windows notification (WinRT toast through Windows PowerShell 5.1), text from the environment so nothing
# is parsed as code: VEILLE_TITLE, VEILLE_BODY. Started hidden by the watcher. Exit 0 when shown.
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$x = $t.GetElementsByTagName('text')
$x.Item(0).AppendChild($t.CreateTextNode([string]$env:VEILLE_TITLE)) | Out-Null
$x.Item(1).AppendChild($t.CreateTextNode([string]$env:VEILLE_BODY)) | Out-Null
$n = [Windows.UI.Notifications.ToastNotification]::new($t)
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show($n)
