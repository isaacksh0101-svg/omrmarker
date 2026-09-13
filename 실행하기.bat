@echo off
setlocal
chcp 65001 >nul
title OMR 프로그램 실행 도우미

cd /d "%~dp0"

echo [OMR] 실행 준비 중...

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo [오류] Node.js가 설치되어 있지 않습니다.
    echo Node.js 22 이상을 설치한 뒤 다시 실행해 주세요.
    echo https://nodejs.org/
    echo.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo.
    echo [오류] npm을 찾을 수 없습니다. Node.js를 다시 설치해 주세요.
    echo.
    pause
    exit /b 1
)

node -e "process.exit(parseInt(process.versions.node.split('.')[0], 10) < 22 ? 1 : 0)"
if errorlevel 1 (
    echo.
    echo [오류] Node.js 22 이상이 필요합니다. 현재 버전:
    node --version
    echo https://nodejs.org/
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 (
    echo.
    echo [안내] OMR 프로그램이 이미 실행 중인 것 같습니다 ^(포트 4000번이 사용 중입니다^).
    echo 이미 열려 있는 OMR 프로그램 창이 있다면 그 창을 사용해 주세요.
    echo 그런 창이 없는데 이 메시지가 계속 뜨면 컴퓨터를 재시작한 뒤 다시 실행해 주세요.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\concurrently" (
    echo [OMR] 처음 실행이라 필요한 패키지를 설치합니다.
    echo 인터넷 연결 상태에 따라 몇 분 정도 걸릴 수 있습니다.
    call npm install
    if errorlevel 1 (
        echo.
        echo [오류] 패키지 설치에 실패했습니다.
        echo 인터넷 연결을 확인한 후 다시 실행해 주세요.
        echo.
        pause
        exit /b 1
    )
)

REM 바탕화면에 예쁜 아이콘 바로가기를 만들어둔다(처음 한 번은 이 파일을 직접 더블클릭해야 하지만,
REM 그 다음부터는 바탕화면 아이콘으로 실행할 수 있게). 폴더를 어디로 옮기거나 다른 PC에서 실행해도
REM %~f0/%~dp0는 항상 "지금 이 파일이 실제로 있는 위치"를 가리키므로 매번 다시 만들어도 항상 정확하다.
powershell -NoProfile -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut(\"$env:USERPROFILE\Desktop\OMR 프로그램.lnk\"); $s.TargetPath = '%~f0'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = \"$env:SystemRoot\System32\shell32.dll,13\"; $s.Description = 'OMR 프로그램 실행'; $s.Save()" >nul 2>&1

echo [OMR] 시험지/학생 화면을 준비합니다(처음 실행이면 시간이 좀 더 걸릴 수 있어요).
echo 이 창을 닫으면 프로그램도 종료됩니다.
echo.

start "" /b cmd /c "%SystemRoot%\System32\timeout.exe /t 8 /nobreak >nul && start http://localhost:4000"
call npm start

echo.
echo [OMR] 프로그램이 종료되었습니다.
pause
