@echo off
setlocal enabledelayedexpansion

rem Adjust gltfpack path if installed elsewhere:
set "GLTFPACK=C:\Users\Stephen\node_modules\.bin\gltfpack.cmd"

rem Target directory and reduction ratio (0–1: keep this fraction of triangles)
set "INPUT_DIR=%~dp0..\models"
set "RATIO=0.25"

if not exist "%GLTFPACK%" (
  echo gltfpack not found at %GLTFPACK%
  exit /b 1
)

for %%F in ("%INPUT_DIR%\*.glb" "%INPUT_DIR%\*.gltf") do (
  if exist "%%~fF" (
    echo Simplifying %%~nxF (ratio=%RATIO%)
    call "%GLTFPACK%" -i "%%~fF" -o "%%~fF" -si %RATIO% -cc -kn
  )
)

echo Done. Files overwritten in %INPUT_DIR%.
endlocal
