; Inno Setup script for Aryx
; Dynamic values are read from environment variables set by the build script.

#define PRODUCT_NAME "Aryx"
#define PRODUCT_PUBLISHER "David Kaya"
#define PRODUCT_VERSION GetEnv("ARYX_BUILD_VERSION")
#define SOURCE_DIR GetEnv("ARYX_BUILD_SOURCE_DIR")
#define OUTPUT_DIR GetEnv("ARYX_BUILD_OUTPUT_DIR")
#define OUTPUT_FILENAME GetEnv("ARYX_BUILD_OUTPUT_FILENAME")
#define ICON_PATH GetEnv("ARYX_BUILD_ICON_PATH")

#if PRODUCT_VERSION == ""
  #error "ARYX_BUILD_VERSION environment variable must be set."
#endif
#if SOURCE_DIR == ""
  #error "ARYX_BUILD_SOURCE_DIR environment variable must be set."
#endif
#if OUTPUT_DIR == ""
  #error "ARYX_BUILD_OUTPUT_DIR environment variable must be set."
#endif
#if OUTPUT_FILENAME == ""
  #error "ARYX_BUILD_OUTPUT_FILENAME environment variable must be set."
#endif
#if ICON_PATH == ""
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
