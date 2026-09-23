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

# Roda por `cmd`, e não por PowerShell, por causa do log.
#
# O redirecionamento do Windows PowerShell 5.1 grava em UTF-16, e o npm cospe
# UTF-8: o log da primeira versão ficou ilegível, cheio de `Gera├º├úo` e
# `ÔòÉÔòÉ`. O `cmd` repassa os bytes como vieram.
#
# O `docker start` na frente resolve o caso mais comum: a máquina foi ligada
# agora e o Postgres ainda não subiu. Sem banco, a coleta falha inteira.
$linha = "docker start bb-pg >nul 2>&1 & npm run atualizar >> `"$logFile`" 2>&1"

$acao = New-ScheduledTaskAction -Execute "cmd.exe" `
    -Argument "/c $linha" `
    -WorkingDirectory $projeto

# De hora em hora, das 5h às 19h, TODO DIA.
#
# A primeira versão usava `-Once` com repetição de 14 horas, e isso é uma
# armadilha: a repetição vale só para aquele dia. A tarefa rodou no dia em que
# foi criada, rodou mais uma vez no dia seguinte porque o Windows recupera
# ocorrência perdida, e `NextRunTime` ficou **vazio** — ela não rodaria nunca
# mais, sem erro nenhum, com o estado marcado como "Ready".
#
# O jeito certo no Windows é um gatilho diário com o padrão de repetição
# enxertado de um gatilho `-Once`. Não há cmdlet que faça os dois de uma vez.
$gatilho = New-ScheduledTaskTrigger -Daily -At "05:00"
$gatilho.Repetition = (New-ScheduledTaskTrigger -Once -At "05:00" `
    -RepetitionInterval (New-TimeSpan -Hours 1) `
    -RepetitionDuration (New-TimeSpan -Hours 14)).Repetition

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
Write-Host "  de hora em hora, das 5h as 19h, todo dia"
Write-Host "  projeto: $projeto"
Write-Host "  log:     $logFile"

# Confere que a tarefa tem PRÓXIMA execução, e não só passado.
#
# Este trecho existe porque a versão anterior registrava sem erro, ficava com o
# estado "Ready", e mesmo assim nunca mais rodaria — `NextRunTime` vazio era o
# único sinal, e ninguém olha `NextRunTime` por conta própria. Agora o script
# olha por você e avisa alto.
$info = Get-ScheduledTaskInfo -TaskName $nome
if ($info.NextRunTime) {
    Write-Host "  proxima: $($info.NextRunTime)"
} else {
    Write-Host ""
    Write-Warning "A tarefa foi criada mas nao tem proxima execucao agendada."
    Write-Warning "Ela rodaria uma vez e nunca mais. Me avise, porque isso e bug do script."
}

Write-Host ""
Write-Host "Para testar agora:  Start-ScheduledTask -TaskName `"$nome`""
Write-Host "Depois confira a tela Coleta no sistema."
