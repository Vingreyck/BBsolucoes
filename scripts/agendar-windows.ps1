# Agenda o `npm run atualizar` de hora em hora, no Agendador de Tarefas do
# Windows.
#
# É o que faltava para o sistema deixar de depender de alguém lembrar. Em
# 22/09/2026 o Selebi passou onze dias sem coletar nada: os coletores
# funcionavam, a tela mostrava números, e os números eram de 11 de setembro.
#
# Roda de 5h às 19h. Fora dessa janela os coletores se recusam sozinhos, porque
# nenhuma usina gera à noite — agendar só o dia evita acordar o processo
# quinze vezes para ele não fazer nada.
#
# COMO USAR
#
#   1. Abra o PowerShell **como administrador** (a tarefa precisa disso)
#   2. cd C:\Users\Vinicius\Documents\Estudos\BBsolucoes
#   3. powershell -ExecutionPolicy Bypass -File scripts\agendar-windows.ps1
#
# Para conferir depois:  Get-ScheduledTask -TaskName "Selebi - atualizar"
# Para rodar na hora:    Start-ScheduledTask -TaskName "Selebi - atualizar"
# Para remover:          Unregister-ScheduledTask -TaskName "Selebi - atualizar"
#
# O log de cada rodada fica em logs\atualizar.log, dentro do projeto.

$ErrorActionPreference = "Stop"

$nome     = "Selebi - atualizar"
$projeto  = Split-Path -Parent $PSScriptRoot
$logs     = Join-Path $projeto "logs"
$logFile  = Join-Path $logs "atualizar.log"

if (-not (Test-Path (Join-Path $projeto "package.json"))) {
    Write-Error "Não achei package.json em $projeto. Rode o script de dentro do projeto."
}

if (-not (Test-Path $logs)) { New-Item -ItemType Directory -Path $logs | Out-Null }

# O Docker pode não estar de pé quando a tarefa dispara, e sem Postgres a
# coleta falha inteira. Subir o container antes custa segundos e resolve o caso
# mais comum: a máquina foi ligada agora.
$comando = "docker start bb-pg *> `$null; npm run atualizar *>> `"$logFile`""

$acao = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"$comando`"" `
    -WorkingDirectory $projeto

# De hora em hora, das 5h às 19h. A de 19h é a que fecha o dia com o total
# definitivo; depois dela não há o que coletar até o amanhecer.
$gatilho = New-ScheduledTaskTrigger -Once -At (Get-Date -Hour 5 -Minute 0 -Second 0) `
    -RepetitionInterval (New-TimeSpan -Hours 1) `
    -RepetitionDuration (New-TimeSpan -Hours 14)

$config = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

if (Get-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $nome -Confirm:$false
    Write-Host "Tarefa anterior removida."
}

Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho `
    -Settings $config -Description "Coleta os portais e detecta usina parada." | Out-Null

Write-Host ""
Write-Host "Agendado: $nome"
Write-Host "  de hora em hora, das 5h as 19h"
Write-Host "  projeto: $projeto"
Write-Host "  log:     $logFile"
Write-Host ""
Write-Host "Para testar agora:  Start-ScheduledTask -TaskName `"$nome`""
Write-Host "Depois confira a tela Coleta no sistema."
