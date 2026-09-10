# Reverts the "keep system awake" change made 2026-09-09 while the content
# mirror's downloads were running. Restores the EXACT original values this
# machine had before the change (captured via `powercfg /query` beforehand):
#   - Sleep (standby) after: AC 900s (15 min), DC 600s (10 min)
#   - Hibernate after: NOT captured before the change (my oversight) — only
#     one power scheme (Balanced) exists on this machine, so there's no
#     untouched reference scheme to recover the true original from. This
#     restores hibernate to 0 (Never), which is Windows' common modern
#     default and was very likely the value already in effect, but isn't
#     guaranteed to be byte-identical to whatever was actually here before.
#     If you know your own prior hibernate timeout, edit the two lines below.

Write-Host "Restoring sleep timeouts: AC=900s (15 min), DC=600s (10 min)..."
powercfg /change standby-timeout-ac 15
powercfg /change standby-timeout-dc 10

Write-Host "Restoring hibernate timeout to 0 (Never) — see script comment re: not captured originally..."
powercfg /change hibernate-timeout-ac 0
powercfg /change hibernate-timeout-dc 0

Write-Host "`nDone. Current settings:"
powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE | Select-String "Current"
powercfg /query SCHEME_CURRENT SUB_SLEEP HIBERNATEIDLE | Select-String "Current"
