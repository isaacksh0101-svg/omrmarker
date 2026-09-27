@echo off
setlocal
chcp 65001 >nul
title ScoreLab 실행 도우미

cd /d "%~dp0"

echo [ScoreLab] 실행 준비 중...

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
    echo [안내] ScoreLab이 이미 실행 중인 것 같습니다 ^(포트 4000번이 사용 중입니다^).
    echo.
    REM choice 명령은 프롬프트를 띄울 때마다 시스템 삑 소리를 내서, 매번 실행할 때마다
    REM 나는 이 소리가 거슬린다는 피드백에 따라 소리 없는 PowerShell 방식으로 바꿨다.
    powershell -NoProfile -Command "$deadline = (Get-Date).AddSeconds(5); Write-Host -NoNewline '종료하고 새로 시작할까요? 진행 중인 시험이 있다면 학생 연결이 끊깁니다. 5초 뒤 자동으로 계속 진행합니다 (Y/N): '; $key = $null; try { while ((Get-Date) -lt $deadline) { if ([Console]::KeyAvailable) { $key = [Console]::ReadKey($true); break }; Start-Sleep -Milliseconds 100 } } catch { while ((Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 } }; Write-Host ''; if ($key -and ($key.KeyChar -eq 'n' -or $key.KeyChar -eq 'N')) { exit 1 } else { exit 0 }"
    if errorlevel 1 (
        echo.
        echo 이미 열려 있는 창을 사용해 주세요. 이 창은 닫아도 됩니다.
        echo.
        pause
        exit /b 1
    )

    echo [ScoreLab] 기존 프로그램을 종료하는 중...
    powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"

    powershell -NoProfile -Command "$deadline = (Get-Date).AddSeconds(10); while ((Get-Date) -lt $deadline) { if (-not (Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue)) { exit 0 }; Start-Sleep -Milliseconds 200 }; exit 1"
    if errorlevel 1 (
        echo.
        echo [오류] 기존 프로그램을 종료하지 못했습니다. 컴퓨터를 재시작한 뒤 다시 실행해 주세요.
        echo.
        pause
        exit /b 1
    )
    echo [ScoreLab] 종료 완료. 새로 시작합니다...
    echo.
)

REM node_modules가 아예 없거나(처음 실행), package-lock.json이 마지막 설치 이후 바뀌었으면
REM (예: git으로 업데이트를 받아서 새 패키지가 추가된 경우) 다시 설치한다. "concurrently 폴더
REM 있으면 무조건 건너뛰기"만 하면 나중에 package.json에 패키지가 추가돼도 영영 설치가 안 돼서
REM "Cannot find module 'xlsx'" 같은 빌드 오류로 이어질 수 있었다.
set "NEED_INSTALL=0"
if not exist "node_modules\concurrently" set "NEED_INSTALL=1"
if not exist "node_modules\.package-lock.json" set "NEED_INSTALL=1"
if "%NEED_INSTALL%"=="0" (
    powershell -NoProfile -Command "if ((Get-Item 'package-lock.json').LastWriteTime -gt (Get-Item 'node_modules\.package-lock.json').LastWriteTime) { exit 1 } else { exit 0 }"
    if errorlevel 1 set "NEED_INSTALL=1"
)

if "%NEED_INSTALL%"=="1" (
    echo [ScoreLab] 필요한 패키지를 설치/업데이트합니다.
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

echo [ScoreLab] 시험지/학생 화면을 준비합니다(처음 실행이면 시간이 좀 더 걸릴 수 있어요).
echo 이 창을 닫으면 프로그램도 종료됩니다.
echo.

REM 고정 대기 시간(예: 8초) 대신 서버가 실제로 4000번 포트에서 응답을 시작할 때까지 기다렸다가
REM 브라우저를 연다. 빌드(tsc+vite)가 오래 걸리면(특히 OneDrive 폴더라 디스크가 느릴 때) 8초보다
REM 늦게 준비되는 경우가 있었고, 그때 너무 일찍 열린 브라우저에서 "연결이 거부되었습니다"가 떴다.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "$deadline = (Get-Date).AddSeconds(120); while ((Get-Date) -lt $deadline) { if (Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue) { Start-Process 'http://localhost:4000'; exit }; Start-Sleep -Milliseconds 500 }"
call npm start

echo.
echo [ScoreLab] 종료되었습니다.
timeout /t 2 >nul
