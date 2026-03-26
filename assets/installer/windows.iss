; Inno Setup script for Aryx
; Metadata values are passed via /D preprocessor defines from the build script.

#ifndef PRODUCT_NAME
  #define PRODUCT_NAME "Aryx"
#endif
#ifndef PRODUCT_VERSION
  #define PRODUCT_VERSION "0.0.0"
#endif
#ifndef PRODUCT_PUBLISHER
  #define PRODUCT_PUBLISHER "David Kaya"
#endif
#ifndef SOURCE_DIR
  #error "SOURCE_DIR must be defined (path to the packaged app directory)."
#endif
#ifndef OUTPUT_DIR
  #error "OUTPUT_DIR must be defined (path to the output directory)."
#endif
#ifndef OUTPUT_FILENAME
  #error "OUTPUT_FILENAME must be defined (output installer filename without extension)."
#endif

#ifndef ICON_PATH
  #define ICON_PATH SOURCE_DIR + "\" + PRODUCT_NAME + ".exe"
#endif

[Setup]
AppId={{B8A3E7F1-4D2C-4A9B-8E6F-1C3D5A7B9E0F}
AppName={#PRODUCT_NAME}
AppVersion={#PRODUCT_VERSION}
AppPublisher={#PRODUCT_PUBLISHER}
AppSupportURL=https://github.com/davidkaya/aryx
DefaultDirName={localappdata}\Programs\{#PRODUCT_NAME}
DefaultGroupName={#PRODUCT_NAME}
PrivilegesRequired=lowest
OutputDir={#OUTPUT_DIR}
OutputBaseFilename={#OUTPUT_FILENAME}
Compression=lzma2/ultra64
SolidCompression=yes
SetupIconFile={#ICON_PATH}
UninstallDisplayIcon={app}\{#PRODUCT_NAME}.exe
WizardStyle=modern
DisableProgramGroupPage=yes
CloseApplications=force
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#SOURCE_DIR}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#PRODUCT_NAME}"; Filename: "{app}\{#PRODUCT_NAME}.exe"
Name: "{autodesktop}\{#PRODUCT_NAME}"; Filename: "{app}\{#PRODUCT_NAME}.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Run]
Filename: "{app}\{#PRODUCT_NAME}.exe"; Description: "{cm:LaunchProgram,{#PRODUCT_NAME}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssInstall then
  begin
    Exec('taskkill', '/F /IM {#PRODUCT_NAME}.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    Exec('taskkill', '/F /IM {#PRODUCT_NAME}.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;
