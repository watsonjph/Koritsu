; Koritsu installer (Inno Setup 6). Build after `cargo build --release`:
;   ISCC.exe installer\koritsu.iss
; Output: dist\Koritsu-Setup-<version>.exe
;
; Per-user install (no admin prompt) into %LOCALAPPDATA%\Programs\Koritsu, with a Start Menu
; shortcut that registers the app ID Windows uses for notifications. Your data in
; %APPDATA%\koritsu is left alone on uninstall.

#define AppVersion "0.4.0"
#define AppId "dev.koritsu.Koritsu"

[Setup]
AppId={{8F3C2A51-6B7E-4E2B-9A1D-3C5E7F9B2D41}
AppName=Koritsu
AppVersion={#AppVersion}
AppVerName=Koritsu {#AppVersion}
AppPublisher=watsonjph
AppPublisherURL=https://github.com/watsonjph/Koritsu
AppSupportURL=https://github.com/watsonjph/Koritsu/issues
DefaultDirName={localappdata}\Programs\Koritsu
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=Koritsu-Setup-{#AppVersion}
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\Koritsu.exe
UninstallDisplayName=Koritsu
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Close a running Koritsu before replacing it.
CloseApplications=force

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked
Name: "autostart"; Description: "Start Koritsu when Windows starts"; Flags: unchecked

[Files]
Source: "..\target\release\koritsu.exe"; DestDir: "{app}"; DestName: "Koritsu.exe"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Koritsu"; Filename: "{app}\Koritsu.exe"; AppUserModelID: "{#AppId}"
Name: "{autodesktop}\Koritsu"; Filename: "{app}\Koritsu.exe"; AppUserModelID: "{#AppId}"; Tasks: desktopicon

[Registry]
; Same entry the app's own "Start with Windows" toggle writes: launch hidden in the tray.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Koritsu"; ValueData: """{app}\Koritsu.exe"" --hidden"; Tasks: autostart
; Remove it on uninstall even if it was turned on from inside the app.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "Koritsu"; Flags: uninsdeletevalue

[Run]
Filename: "{app}\Koritsu.exe"; Description: "Launch Koritsu"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Koritsu keeps running in the tray; close it so its files can be removed.
Filename: "{sys}\taskkill.exe"; Parameters: "/IM Koritsu.exe /F"; Flags: runhidden; RunOnceId: "CloseKoritsu"
