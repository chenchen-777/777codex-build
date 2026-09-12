param([Parameter(Mandatory=$true)][string]$Plan)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$p=Get-Content -LiteralPath $Plan -Raw -Encoding UTF8|ConvertFrom-Json
if($p.schemaVersion-ne 2-or![IO.Path]::IsPathRooted([string]$p.archivePath)-or![IO.Path]::IsPathRooted([string]$p.installRoot)-or![IO.Path]::IsPathRooted([string]$p.managerRoot)-or![IO.Path]::IsPathRooted([string]$p.executable)-or[int]$p.parentPid-lt 1-or[int]$p.sidecarPid-lt 1-or[int]$p.targetRevision-le[int]$p.currentRevision-or[long]$p.parentStartEpochMs-lt 1-or[long]$p.sidecarStartEpochMs-lt 1){throw'Invalid update plan'}
$install=[IO.Path]::GetFullPath([string]$p.installRoot).TrimEnd('\');$manager=[IO.Path]::GetFullPath([string]$p.managerRoot).TrimEnd('\')
if($manager-eq$install-or$manager.StartsWith($install+'\',[StringComparison]::OrdinalIgnoreCase)-or$install.StartsWith($manager+'\',[StringComparison]::OrdinalIgnoreCase)){throw'Manager and install roots must be disjoint'}
$executable=[IO.Path]::GetFullPath([string]$p.executable);if(!$executable.StartsWith($install+'\',[StringComparison]::OrdinalIgnoreCase)){throw'Executable escaped install root'}
$updates=Join-Path $manager 'Updates';New-Item -ItemType Directory -Force -Path $updates|Out-Null
$id=[guid]::NewGuid().ToString('N');$stage=Join-Path $updates "stage-$id";$backup=Join-Path $updates "backup-$id";$journal=Join-Path $updates 'apply-journal.json';$result=Join-Path $updates 'last-update-result.json'
$reserved='^(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$'
function Relative([string]$s){
 $n=$s.Replace('\','/').TrimEnd('/');if(!$n-or$n.StartsWith('/')-or$n.StartsWith('//')-or$n-match'^[A-Za-z]:'-or$n.Contains(':')){throw"Unsafe path: $s"}
 $parts=$n.Split('/');foreach($x in $parts){if(!$x-or$x-eq'.'-or$x-eq'..'-or$x-match$reserved-or$x.EndsWith('.')-or$x.EndsWith(' ')){throw"Unsafe path: $s"}}
 $full=[IO.Path]::GetFullPath((Join-Path $install ($parts-join'\')));if(!$full.StartsWith($install+'\',[StringComparison]::OrdinalIgnoreCase)){throw"Escaped path: $s"};$n
}
function Hash([string]$f){(Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant()}
function Process-State([int]$processId,[long]$expectedStart,[string]$expectedPath=''){$q=Get-Process -Id $processId -ErrorAction SilentlyContinue;if(!$q){return $false};$actual=[DateTimeOffset]$q.StartTime.ToUniversalTime();if([Math]::Abs($actual.ToUnixTimeMilliseconds()-$expectedStart)-gt 3000){throw'Process identity changed'};if($expectedPath-and([IO.Path]::GetFullPath($q.Path)-ne[IO.Path]::GetFullPath($expectedPath))){throw'Process executable changed'};$true}
function Assert-No-Reparse([string]$path){$q=[IO.Path]::GetFullPath($path);while($q.StartsWith($install,[StringComparison]::OrdinalIgnoreCase)){if(Test-Path -LiteralPath $q){if(((Get-Item -LiteralPath $q -Force).Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw'Reparse target rejected'}};if($q-eq$install){break};$q=Split-Path $q -Parent}}
function Save-Journal($state,$done){@{schemaVersion=1;state=$state;installRoot=$install;backup=$backup;files=@($done)}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath ($journal+'.new') -Encoding UTF8;Move-Item -LiteralPath ($journal+'.new') -Destination $journal -Force}
$zip=$null;$done=New-Object Collections.Generic.List[string];$committed=$false;$failed=$false
try{
 $want=@{};foreach($f in @($p.packageFiles)){$r=Relative([string]$f.path);$k=$r.ToLowerInvariant();if($want.ContainsKey($k)){throw'Duplicate/case-colliding inventory path'};if([long]$f.bytes-lt 0-or([string]$f.sha256)-notmatch'^[0-9a-fA-F]{64}$'){throw'Invalid inventory'};$want[$k]=$f}
 if(!$want.Count){throw'Empty inventory'}
 Assert-No-Reparse $install
 if((Get-Item -LiteralPath ([string]$p.archivePath)).Length-ne[long]$p.archiveBytes-or(Hash ([string]$p.archivePath))-ne([string]$p.archiveSha256).ToLowerInvariant()){throw'Archive verification failed'}
 $zip=[IO.Compression.ZipFile]::OpenRead([string]$p.archivePath);$seen=@{}
 foreach($e in $zip.Entries){if($e.FullName.EndsWith('/')){continue};$r=Relative $e.FullName;$k=$r.ToLowerInvariant();if($seen.ContainsKey($k)-or!$want.ContainsKey($k)){throw'Archive inventory mismatch'};$mode=($e.ExternalAttributes-shr 16)-band 0xF000;if($mode-eq 0xA000){throw'Symlink entry rejected'};$seen[$k]=$e}
 if($seen.Count-ne$want.Count){throw'Archive inventory mismatch'}
 New-Item -ItemType Directory -Path $stage,$backup|Out-Null
 foreach($k in $want.Keys){$f=$want[$k];$e=$seen[$k];$dst=Join-Path $stage ((Relative $f.path).Replace('/','\'));New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent)|Out-Null;$src=$e.Open();$out=[IO.File]::Create($dst);try{$src.CopyTo($out)}finally{$out.Dispose();$src.Dispose()};if((Get-Item -LiteralPath $dst).Length-ne[long]$f.bytes-or(Hash $dst)-ne([string]$f.sha256).ToLowerInvariant()){throw'Payload verification failed'}}
 $zip.Dispose();$zip=$null
 $until=(Get-Date).AddSeconds(60);while((($(Process-State ([int]$p.parentPid) ([long]$p.parentStartEpochMs) $executable))-or($(Process-State ([int]$p.sidecarPid) ([long]$p.sidecarStartEpochMs) ([string]$p.sidecarExecutable))))-and(Get-Date)-lt$until){Start-Sleep -Milliseconds 250};if(($(Process-State ([int]$p.parentPid) ([long]$p.parentStartEpochMs) $executable))-or($(Process-State ([int]$p.sidecarPid) ([long]$p.sidecarStartEpochMs) ([string]$p.sidecarExecutable)))){throw'Application processes did not exit'}
 $oldJournal=$null;if(Test-Path -LiteralPath $journal){$oldJournal=Get-Content -LiteralPath $journal -Raw -Encoding UTF8|ConvertFrom-Json};if($oldJournal-and$oldJournal.state-eq'applying'){if([IO.Path]::GetFullPath([string]$oldJournal.installRoot)-ne$install){throw'Pending recovery root mismatch'};foreach($old in @($oldJournal.files)){$dst=Join-Path $install ([string]$old).Replace('/','\');$bak=Join-Path ([string]$oldJournal.backup) ([string]$old).Replace('/','\');if(Test-Path -LiteralPath $bak -PathType Leaf){Copy-Item -LiteralPath $bak -Destination $dst -Force}else{Remove-Item -LiteralPath $dst -Force -ErrorAction SilentlyContinue}};$oldJournal.state='rolled-back';$oldJournal|ConvertTo-Json -Depth 5|Set-Content -LiteralPath ($journal+'.new') -Encoding UTF8;Move-Item -LiteralPath ($journal+'.new') -Destination $journal -Force}
 Save-Journal 'applying' $done
 foreach($k in $want.Keys){$r=Relative([string]$want[$k].path);$src=Join-Path $stage $r.Replace('/','\');$dst=Join-Path $install $r.Replace('/','\');$bak=Join-Path $backup $r.Replace('/','\');Assert-No-Reparse (Split-Path $dst -Parent);New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent),(Split-Path $bak -Parent)|Out-Null;if(Test-Path -LiteralPath $dst -PathType Leaf){Copy-Item -LiteralPath $dst -Destination $bak};Save-Journal 'applying' @($done)+@($r);Copy-Item -LiteralPath $src -Destination ($dst+'.update-new') -Force;$ok=$false;for($i=0;$i-lt20-and!$ok;$i++){try{Move-Item -LiteralPath ($dst+'.update-new') -Destination $dst -Force;$ok=$true}catch{Start-Sleep -Milliseconds 250}};if(!$ok){throw"Locked update target: $r"};$done.Add($r);if($env:MANAGER777_UPDATE_FAIL_AFTER-and$done.Count-ge[int]$env:MANAGER777_UPDATE_FAIL_AFTER){throw'Injected update failure'};Save-Journal 'applying' $done}
 foreach($k in $want.Keys){$f=$want[$k];$dst=Join-Path $install ((Relative $f.path).Replace('/','\'));if((Hash $dst)-ne([string]$f.sha256).ToLowerInvariant()){throw'Installed hash mismatch'}}
 $committed=$true;Save-Journal 'committed' $done;@{status='success';targetRevision=$p.targetRevision}|ConvertTo-Json|Set-Content -LiteralPath $result -Encoding UTF8
}catch{
 $failed=$true
 for($i=$done.Count-1;$i-ge0;$i--){$r=$done[$i];$dst=Join-Path $install $r.Replace('/','\');$bak=Join-Path $backup $r.Replace('/','\');if(Test-Path -LiteralPath $bak -PathType Leaf){Copy-Item -LiteralPath $bak -Destination $dst -Force}else{Remove-Item -LiteralPath $dst -Force -ErrorAction SilentlyContinue}}
 Save-Journal 'rolled-back' $done;@{status='error';message=$_.Exception.Message}|ConvertTo-Json|Set-Content -LiteralPath $result -Encoding UTF8
}finally{if($zip){$zip.Dispose()};Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue;if($committed-and!(Get-Process -Id ([int]$p.parentPid) -ErrorAction SilentlyContinue)-and!(Get-Process -Id ([int]$p.sidecarPid) -ErrorAction SilentlyContinue)){Start-Process -FilePath $executable -WorkingDirectory $install}}
if($failed){exit 1}
