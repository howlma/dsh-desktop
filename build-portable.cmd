@echo off
setlocal
title dsh-desktop portable build
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
    echo [ERROR] Electron not installed. Run: npm install
    exit /b 1
)

echo Cleaning dist...
if exist "dist" rmdir /s /q "dist"
mkdir "dist\portable\resources\app"

echo Copying Electron runtime...
xcopy "node_modules\electron\dist\*" "dist\portable\" /E /I /Q /Y >nul

echo Copying app files...
copy /Y "main.js" "dist\portable\resources\app\" >nul
copy /Y "preload.js" "dist\portable\resources\app\" >nul
copy /Y "package.json" "dist\portable\resources\app\" >nul
xcopy "lib" "dist\portable\resources\app\lib\" /E /I /Q /Y >nul
xcopy "renderer" "dist\portable\resources\app\renderer\" /E /I /Q /Y >nul

echo Creating zip...
powershell -NoProfile -Command "Compress-Archive -Path 'dist\portable\*' -DestinationPath 'dist\dsh-desktop-portable.zip' -Force"

echo.
echo Done: dist\dsh-desktop-portable.zip
echo Extract and double-click electron.exe to run.
exit /b 0
