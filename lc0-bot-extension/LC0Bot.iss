#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

#define MyAppName "LC0 Bot Native Host"
#define MyHostName "com.lc0bot.nativehost"
#define MyExtensionId "fpcmlebcligjofgppbfhaciaildiieaj"

[Setup]
AppId={{B6298D39-3C23-4E14-BFE9-54B6311C70A8}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=LC0 Bot Contributors
DefaultDirName={localappdata}\LC0Bot
DefaultGroupName=LC0 Bot
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=LC0Bot-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
UninstallDisplayName=LC0 Bot Native Host

[Files]
Source: "dist\lc0-native-host.exe"; DestDir: "{app}"; Flags: ignoreversion

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
  if not FileExists(AddBackslash(Directory) + 'lc0.exe') then
  begin
    MsgBox('The selected folder must contain lc0.exe from the official Windows CPU package.', mbError, MB_OK);
    Exit;
  end;
  if not FileExists(AddBackslash(Directory) + 'dnnl.dll') then
  begin
    MsgBox('The selected folder must contain dnnl.dll from the official Windows CPU/oneDNN package.', mbError, MB_OK);
    Exit;
  end;
  FirstWeight := '';
  WeightCount := CountWeightsInDirectory(Directory, FirstWeight);
  WeightCount := WeightCount + CountWeightsInDirectory(AddBackslash(Directory) + 'weights', FirstWeight);
  if WeightCount = 0 then
  begin
    MsgBox('No .pb.gz weight was found. Put exactly one weight in the LC0 folder or its weights folder, then select the folder again.', mbError, MB_OK);
    Exit;
  end;
  if WeightCount > 1 then
  begin
    MsgBox('More than one .pb.gz weight was found. Keep exactly one weight in the LC0 folder (including its weights folder).', mbError, MB_OK);
    Exit;
  end;
  Result := True;
end;

procedure InitializeWizard;
begin
  EngineDirPage := CreateInputDirPage(wpSelectDir, 'Select your LC0 folder', 'Choose the official LC0 CPU package folder', 'Select the folder that contains lc0.exe and exactly one .pb.gz weight. The engine and weight stay in this folder; Setup does not copy or download them.', False, '');
  EngineDirPage.Add('LC0 folder:');
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
  ManifestPath := ExpandConstant('{app}\com.lc0bot.nativehost.json');
  ConfigJson := '{"protocolVersion":1,"engineDir":"' + JsonEscape(EngineDirPage.Values[0]) + '"}';
  ManifestJson := '{"name":"{#MyHostName}","description":"LC0 Bot Native Messaging host","path":"' + JsonEscape(ExpandConstant('{app}\lc0-native-host.exe')) + '","type":"stdio","allowed_origins":["chrome-extension://{#MyExtensionId}/"]}';
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
