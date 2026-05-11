; WFP Semantic Guard - DEV Installer (Driver only)
; Requires Admin. Uses pnputil. For DEV, may require testsigning ON.

#define MyAppName "WFP Semantic Guard"
#define MyAppVersion "0.1-dev"
#define MyPublisher "Lucian"
#define MyExeName "WfpSemanticGuard"

[Setup]
AppId={{A1B2C3D4-E5F6-47A1-9C9A-1234567890AB}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyPublisher}
DefaultDirName={autopf}\{#MyAppName}
DisableProgramGroupPage=yes
OutputBaseFilename={#MyExeName}_Setup_{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayIcon={app}\{#MyExeName}.exe

[Files]
Source: "..\build\Release\WfpGuardDriver.sys"; DestDir: "{app}\driver"; Flags: ignoreversion
Source: "..\build\Release\wfp_guard.inf";     DestDir: "{app}\driver"; Flags: ignoreversion

; (optional) small stub exe to show in Programs & Features
Source: "{tmp}\dummy.txt"; DestDir: "{app}"; DestName: "{#MyExeName}.exe"; Flags: external skipifsourcedoesntexist

[Run]
; Install driver package into Driver Store + install
Filename: "{cmd}"; Parameters: "/c pnputil /add-driver ""{app}\driver\wfp_guard.inf"" /install"; Flags: runhidden waituntilterminated
; Start service (defined in INF as WfpGuard)
Filename: "{cmd}"; Parameters: "/c sc start WfpGuard"; Flags: runhidden waituntilterminated; Check: ServiceExists

[UninstallRun]
; Stop service
Filename: "{cmd}"; Parameters: "/c sc stop WfpGuard"; Flags: runhidden waituntilterminated; Check: ServiceExists
; Remove driver package by PublishedName (oemXX.inf)
Filename: "{cmd}"; Parameters: "/c for /f ""tokens=2 delims=: "" %%%%A in ('pnputil /enum-drivers ^| findstr /i /c:""WfpGuard"" /c:""wfp_guard.inf""') do pnputil /delete-driver %%%%A /uninstall /force"; Flags: runhidden waituntilterminated

[Code]
function ServiceExists(): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec(ExpandConstant('{cmd}'), '/c sc query WfpGuard >nul 2>&1', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;
