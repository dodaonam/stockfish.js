#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

#define MyAppName "STF Bot Native Host"
#define MyHostName "com.stfbot.nativehost"
#define MyExtensionId "mmojcpabkokldigcjilffhopohnkldie"

[Setup]
AppId={{B19122B1-CA34-4809-BB3D-AE0324815528}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=STF Bot Contributors
DefaultDirName={localappdata}\STFBot
DefaultGroupName=STF Bot
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=STFBot-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
UninstallDisplayName=STF Bot Native Host

[Files]
Source: "dist\stf-native-host.exe"; DestDir: "{app}"; Flags: ignoreversion

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
var
  EngineFilePage: TInputFileWizardPage;

function JsonEscape(Value: String): String;
begin
  Result := Value;
  StringChange(Result, '\', '\\');
  StringChange(Result, '"', '\"');
end;

function ValidateEngineFile(const EnginePath: String): Boolean;
begin
  Result := False;
  if not FileExists(EnginePath) then
  begin
    MsgBox('The selected file does not exist.', mbError, MB_OK);
    Exit;
  end;
  if Lowercase(ExtractFileExt(EnginePath)) <> '.exe' then
  begin
    MsgBox('Please select a Windows executable (.exe).', mbError, MB_OK);
    Exit;
  end;
  Result := True;
end;

procedure InitializeWizard;
begin
  EngineFilePage := CreateInputFilePage(wpSelectDir, 'Select your Stockfish executable', 'Choose the Stockfish executable', 'Select a Stockfish Windows executable. Setup does not copy or download Stockfish.');
  EngineFilePage.Add('Stockfish executable:', 'Executable files (*.exe)|*.exe|All files|*.*', 'exe');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = EngineFilePage.ID then Result := ValidateEngineFile(EngineFilePage.Values[0]);
end;

procedure WriteHostFiles;
var
  ConfigPath, ManifestPath, ConfigJson, ManifestJson, RegistryKey: String;
begin
  ConfigPath := ExpandConstant('{app}\engine-config.json');
  ManifestPath := ExpandConstant('{app}\com.stfbot.nativehost.json');
  ConfigJson := '{"protocolVersion":1,"enginePath":"' + JsonEscape(EngineFilePage.Values[0]) + '"}';
  ManifestJson := '{"name":"{#MyHostName}","description":"STF Bot Native Messaging host","path":"' + JsonEscape(ExpandConstant('{app}\stf-native-host.exe')) + '","type":"stdio","allowed_origins":["chrome-extension://{#MyExtensionId}/"]}';
  if not SaveStringToFile(ConfigPath, ConfigJson, False) then
  begin
    MsgBox('Could not write STF engine configuration.', mbError, MB_OK);
    Abort;
  end;
  if not SaveStringToFile(ManifestPath, ManifestJson, False) then
  begin
    MsgBox('Could not write STF Native Messaging manifest.', mbError, MB_OK);
    Abort;
  end;
  RegistryKey := 'Software\Google\Chrome\NativeMessagingHosts\{#MyHostName}';
  if not RegWriteStringValue(HKCU, RegistryKey, '', ManifestPath) then
  begin
    MsgBox('Could not register STF Native Messaging host.', mbError, MB_OK);
    Abort;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then WriteHostFiles;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Google\Chrome\NativeMessagingHosts\{#MyHostName}');
end;
