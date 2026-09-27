# ScoreLab Windows 패키징

현재 server/client 코드를 Electron 앱으로 묶어 Windows 설치 프로그램을 만듭니다.
설치본에는 Node.js 런타임과 서버 프로덕션 의존성이 포함되므로 사용자 PC에 Node.js를
별도로 설치할 필요가 없습니다.

## 빌드

저장소 루트에서 다음 명령을 실행합니다.

```powershell
npm.cmd run package:windows
```

또는 `electron` 폴더에서 `npm.cmd run dist`를 실행할 수 있습니다. 빌드 과정은
클라이언트를 빌드하고, 서버 소스와 프로덕션 의존성 및 교육과정 데이터를 모은 뒤,
NSIS 설치 마법사를 생성합니다.

결과물은 `electron/release`에 생성됩니다.

- `ScoreLab-Setup-<버전>-x64.exe`: 배포할 설치 프로그램
- `SHA256SUMS.txt`: 설치 파일 무결성 확인용 해시
- `RELEASE-MANIFEST.json`: 버전, 빌드 시각, 소스 커밋, 서명 상태
- 변경 내역, 보안 정책, 라이선스 및 SBOM 문서

설치 프로그램은 사용자별 설치, 설치 위치 선택, 바탕화면 및 시작 메뉴 바로가기를
지원합니다. 제거할 때 사용자 데이터는 자동 삭제하지 않습니다.

## 데이터 위치

실제 시험지와 응시 데이터는 기본적으로 `%APPDATA%\ScoreLab\data`에 저장됩니다.
앱 설정에서 저장 위치를 변경할 수 있으며, 업데이트 설치 시 기존 데이터를 유지합니다.

## 코드 서명

인증서가 없는 로컬 빌드는 서명 없이 생성되므로 Windows SmartScreen 경고가 나타날 수
있습니다. `CSC_LINK`(또는 `WIN_CSC_LINK`)와 관련 암호 환경변수를 설정하면
electron-builder의 코드 서명 절차가 활성화됩니다.

## 아이콘

현재 커스텀 아이콘이 없으면 Electron 기본 아이콘을 사용합니다. 256x256 이상의
`icon.ico`를 `electron/build/icon.ico`에 넣고 `electron/package.json`의 `build.win.icon`에
`"build/icon.ico"`를 지정하면 적용됩니다.
