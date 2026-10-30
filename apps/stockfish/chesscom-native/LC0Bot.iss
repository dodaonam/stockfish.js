#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

#define MyAppName "STF Bot Native Host"
#define MyHostName "com.stfbot.nativehost"
#define MyExtensionId "nmpjdpablolleigckilffhppohokldie"

[Setup]
AppId={{B6298D39-3C23-4E14-BFE9-54B6311C70A8}
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
  EngineDirPage: TInputDirWizardPage;

function JsonEscape(Value: String): String;
begin
  Result := Value;
  StringChange(Result, '\', '\\');
  StringChange(Result, '"', '\"');
end;

function CountWeightsInDirectory(const Directory: String; var FirstWeight: String): Integer;
var
  FindRec: TFindRec;
begin
  Result := 0;
  if not DirExists(Directory) then Exit;
  if FindFirst(AddBackslash(Directory) + '*.pb.gz', FindRec) then
  begin
    try
      repeat
        if (FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY) = 0 then
        begin
          Inc(Result);
          if FirstWeight = '' then FirstWeight := AddBackslash(Directory) + FindRec.Name;
        end;
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end;
end;

function ValidateEngineDirectory(const Directory: String): Boolean;
var
  FirstWeight: String;
  WeightCount: Integer;
begin
  Result := False;
  if not FileExists(AddBackslash(Directory) + 'stockfish-windows-x86-64-avx2.exe') then
  begin
    MsgBox('The selected folder must contain stockfish-windows-x86-64-avx2.exe.', mbError, MB_OK);
    Exit;
  end;
  Result := True;
end;

procedure InitializeWizard;
begin
  EngineDirPage := CreateInputDirPage(wpSelectDir, 'Select your Stockfish folder', 'Choose the Stockfish folder', 'Select the folder that contains stockfish-windows-x86-64-avx2.exe. Setup does not copy or download Stockfish.', False, '');
  EngineDirPage.Add('Stockfish folder:');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = EngineDirPage.ID then Result := ValidateEngineDirectory(EngineDirPage.Values[0]);
end;

procedure WriteHostFiles;
var
  ConfigPath, ManifestPath, ConfigJson, ManifestJson, RegistryKey: String;
begin
  ConfigPath := ExpandConstant('{app}\engine-config.json');
  ManifestPath := ExpandConstant('{app}\com.stfbot.nativehost.json');
  ConfigJson := '{"protocolVersion":1,"enginePath":"' + JsonEscape(AddBackslash(EngineDirPage.Values[0]) + 'stockfish-windows-x86-64-avx2.exe') + '"}';
  ManifestJson := '{"name":"{#MyHostName}","description":"STF Bot Native Messaging host","path":"' + JsonEscape(ExpandConstant('{app}\stf-native-host.exe')) + '","type":"stdio","allowed_origins":["chrome-extension://{#MyExtensionId}/"]}';
  SaveStringToFile(ConfigPath, ConfigJson, False);
  SaveStringToFile(ManifestPath, ManifestJson, False);
  RegistryKey := 'Software\Google\Chrome\NativeMessagingHosts\{#MyHostName}';
  RegWriteStringValue(HKCU, RegistryKey, '', ManifestPath);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then WriteHostFiles;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Google\Chrome\NativeMessagingHosts\{#MyHostName}');
end;
