# Prevents the system from sleeping/hibernating — applied 2026-09-09 so the
# content mirror's long-running background downloads aren't interrupted.
# To undo, run power-revert-keep-awake.ps1 in this same folder.
Write-Host "Disabling sleep and hibernate (AC + battery)..."
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0
powercfg /change hibernate-timeout-ac 0
powercfg /change hibernate-timeout-dc 0

Write-Host "`nDone. Current settings:"
powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE | Select-String "Current"
powercfg /query SCHEME_CURRENT SUB_SLEEP HIBERNATEIDLE | Select-String "Current"
