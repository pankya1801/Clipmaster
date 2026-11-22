Unicode true
!include "MUI2.nsh"
Name "Clipmaster 0.6.0"
OutFile "..\Clipmaster_0.6.0_x64-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Clipmaster 0.6"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section
  SetOutPath "$INSTDIR"
  File "..\src-tauri\target\release\clipmaster.exe"
  File /oname=clipmaster-ffmpeg.exe "..\src-tauri\binaries\clipmaster-ffmpeg-x86_64-pc-windows-msvc.exe"
  File /oname=clipmaster-ffprobe.exe "..\src-tauri\binaries\clipmaster-ffprobe-x86_64-pc-windows-msvc.exe"
  File /oname=clipmaster-whisper-cli.exe "..\src-tauri\binaries\clipmaster-whisper-cli-x86_64-pc-windows-msvc.exe"
  SetOutPath "$INSTDIR\fonts"
  File "..\src-tauri\fonts\*"
  SetOutPath "$INSTDIR\binaries"
  File "..\src-tauri\binaries\*.txt"
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortCut "$SMPROGRAMS\Clipmaster 0.6.lnk" "$INSTDIR\clipmaster.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Clipmaster06" "DisplayName" "Clipmaster 0.6.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Clipmaster06" "UninstallString" '"$INSTDIR\Uninstall.exe"'
SectionEnd
Section "Uninstall"
  Delete "$SMPROGRAMS\Clipmaster 0.6.lnk"
  Delete "$INSTDIR\clipmaster.exe"
  Delete "$INSTDIR\clipmaster-ffmpeg.exe"
  Delete "$INSTDIR\clipmaster-ffprobe.exe"
  Delete "$INSTDIR\clipmaster-whisper-cli.exe"
  Delete "$INSTDIR\Uninstall.exe"
  Delete "$INSTDIR\binaries\FFMPEG-LICENSE.txt"
  Delete "$INSTDIR\binaries\WHISPER-LICENSE.txt"
  RMDir "$INSTDIR\binaries"
  ; Remove only fonts shipped by this installer.
  Delete "$INSTDIR\fonts\Bangers-Regular.ttf"
  Delete "$INSTDIR\fonts\BebasNeue-Regular.ttf"
  Delete "$INSTDIR\fonts\CourierPrime-Regular.ttf"
  Delete "$INSTDIR\fonts\DMSerifDisplay-Italic.ttf"
  Delete "$INSTDIR\fonts\DMSerifDisplay-Regular.ttf"
  Delete "$INSTDIR\fonts\Montserrat-ExtraBold.ttf"
  Delete "$INSTDIR\fonts\Montserrat-Medium.ttf"
  Delete "$INSTDIR\fonts\OFL.txt"
  Delete "$INSTDIR\fonts\Poppins-Bold.ttf"
  Delete "$INSTDIR\fonts\Poppins-Regular.ttf"
  Delete "$INSTDIR\fonts\README.md"
  RMDir "$INSTDIR\fonts"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Clipmaster06"
SectionEnd
