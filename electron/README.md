# ScoreLab 데스크톱 패키징 (v2, 실험 단계)

`실행하기.bat` 대신 진짜 설치 프로그램(.exe)으로 배포하기 위한 Electron 셸입니다.
**server/client 코드는 전혀 건드리지 않고**, 그걸 그대로 자식 프로세스로 띄운 뒤 앱 창
하나로 보여주기만 합니다. 기존 `실행하기.bat` 실행 방식은 그대로 남아있고 서로 영향
없습니다.

## 아직 필요한 것 (Node.js는 여전히 설치돼 있어야 함)

지금 버전은 시스템에 설치된 `node`를 그대로 실행합니다(이유는 [main.js](main.js) 상단
주석 참고 - 네이티브 모듈/`node:sqlite` 호환성 때문에 안전하게 갔습니다). 즉 아직은
"Node.js를 먼저 설치하세요"가 남아있고, 대신 얻는 건:

- 터미널 창 대신 진짜 앱 창
- zip 풀고 `ScoreLab.exe` 더블클릭 한 번으로 실행(실행마다 `npm install` 안 해도 됨 -
  배포 시점에 미리 다 포함됨). 시작 메뉴/바탕화면 바로가기 자동 생성까지는 정식 설치
  마법사(.exe)가 필요한데, 지금은 왜 아직 그게 아닌 zip인지 아래에 적어뒀습니다.
- 여러 번 실행해도 창 하나만 뜨게 처리(기존 창을 앞으로 가져옴)

완전히 Node.js 설치조차 필요 없게 하려면, 나중에 실제 portable `node.exe`를 리소스로
같이 배포하도록 바꾸면 됩니다 - 지금은 안 했습니다.

## 사용법

```bash
# 1) 이 폴더의 의존성 설치 (최초 1회)
cd electron
npm install

# 2) 개발 중 셸만 빠르게 확인 (레포의 server/client를 그대로 씀 - client/dist가 미리
#    빌드돼 있어야 함: 루트에서 `npm run build -w client`)
npm run start

# 3) 실제 설치 프로그램(.exe) 만들기
npm run dist
```

`npm run dist`([build.mjs](build.mjs))는 [prepare.mjs](prepare.mjs)가 먼저 클라이언트를
빌드하고, 서버 소스 + 프로덕션 의존성만 새로 설치해서 `electron/.staging/app`에 깨끗하게
모은 뒤, electron-builder가 그걸 그대로 패키징하고, 마지막으로 7-Zip으로
`electron/release/ScoreLab-win-portable.zip` 하나로 묶습니다. 이 zip만 보내면 받는
쪽에선 풀고 `ScoreLab.exe`를 실행하면 됩니다(별도 설치 과정 없음 - "포터블" 방식).

### 지금은 정식 설치 마법사(.exe)가 아니라 압축 파일(.zip)인 이유

이 PC는 Windows 개발자 모드가 꺼져 있어서(symlink 생성 권한 없음), electron-builder가
쓰는 NSIS/portable 타겟이 내부적으로 내려받는 macOS 코드서명 도구(winCodeSign) 압축을
풀지 못해 실패합니다 - 실제 앱 패키징 자체와는 무관한 곁가지 도구라, `win.target`을
`dir`로 두고 그 결과(`release/win-unpacked`)를 직접 zip으로 묶는 방식으로 우회했습니다.
"설정 > 개인 정보 및 보안 > 개발자용 > 개발자 모드"를 켠 뒤 `package.json`의
`build.win.target`을 `"nsis"`로 되돌리면, 시작 메뉴 등록까지 되는 진짜 설치 마법사를
만들 수 있습니다.

## 데이터 저장 위치

설치 폴더(Program Files 등)는 일반 사용자 쓰기 권한이 없을 수 있어서, 실제 시험지/응시
데이터는 `%APPDATA%\ScoreLab\data`에 저장됩니다(서버에 `SCORELAB_DATA_DIR` 환경변수로
넘겨줌 - [server/src/config.js](../server/src/config.js) 참고). 개발 중(`npm run start`,
`실행하기.bat`)에는 이 환경변수를 안 넘기므로 기존처럼 `server/data`를 그대로 씁니다.

## 아이콘

지금은 커스텀 아이콘 없이 electron-builder 기본 아이콘으로 빌드됩니다. 256x256 이상의
`icon.ico`를 `electron/build/icon.ico`에 넣고 `package.json`의 `build.win.icon`에
`"build/icon.ico"`를 다시 추가하면 적용됩니다.
