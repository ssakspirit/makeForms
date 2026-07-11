# makeForms

Microsoft Forms 편집 화면을 조작해 AI가 생성한 퀴즈 문제를 자동으로 채워 넣는 Chrome 확장 프로그램입니다.

## 동작 방식

1. `forms.office.com`에서 편집 중인 폼을 엽니다.
2. 확장 프로그램 팝업에서 주제/문제 개수/난이도를 입력하고 생성 버튼을 누릅니다.
3. 백그라운드 서비스 워커가 Google Gemini API(`gemini-2.5-flash`)로 문제(JSON)를 생성합니다.
4. 콘텐츠 스크립트가 현재 열려 있는 Forms 편집 화면의 DOM을 조작해 "새 질문 추가" → 제목/보기 입력 → (퀴즈 모드면) 정답 표시까지 자동으로 수행합니다.

Microsoft Forms는 폼 문제를 프로그래밍 방식으로 생성하는 공개 API를 제공하지 않기 때문에(Graph API의 Forms 관련 엔드포인트는 관리자 설정 조회/변경용뿐), 브라우저 DOM 자동화 방식을 사용합니다.

## 설치 (개발자 모드)

1. `chrome://extensions` 접속 후 우측 상단 "개발자 모드" 켜기
2. "압축해제된 확장 프로그램을 로드합니다" 클릭 → 이 저장소의 `extension/` 폴더 선택
3. 확장 아이콘 우클릭 → 옵션(또는 팝업 하단 "API 키 설정") → Gemini API 키 입력 후 저장
   - [aistudio.google.com/apikey](https://aistudio.google.com/apikey)에서 키를 발급받을 수 있습니다.
   - 키는 `chrome.storage.local`에만 저장되고, 문제 생성 요청 시 Google Gemini API로만 전송됩니다.

## 사용법

1. `forms.office.com`에서 편집하려는 폼을 엽니다.
2. 확장 아이콘 클릭 → 주제, 문제 개수(1~20), 난이도, 문제 유형(객관식/혼합), 정답 자동 표시 여부를 설정
3. "AI로 문제 생성 후 자동 입력" 클릭
4. 진행 로그가 팝업 내에 표시됩니다. 팝업을 닫으면 로그는 사라지지만 입력 작업 자체는 계속 진행됩니다.

## 알려진 제한사항

- **선택자(selector)가 깨지기 쉬움**: Microsoft Forms는 공식 확장 API가 없는 내부 UI이므로, 이 확장은 버튼/입력란의 `aria-label` 텍스트 패턴(한국어/영어)을 매칭해 DOM을 조작합니다. Microsoft가 UI 문구나 구조를 바꾸면 동작하지 않을 수 있습니다. 이 경우 `extension/content.js` 상단의 `PATTERNS` 객체에 새 패턴을 추가하면 됩니다.
- **단답형(텍스트) 문제는 실험적**: 새 질문을 추가하면 기본적으로 객관식 카드가 생성됩니다. 단답형으로 전환하는 유형 변경 UI 자동화는 아직 구현하지 않아, 제목만 입력된 객관식 카드로 남고 수동 전환이 필요합니다.
- **정답 자동 표시는 퀴즈 모드에서만 동작**: 일반 설문 폼에는 정답 표시 UI 자체가 없으므로 해당 옵션은 자동으로 건너뜁니다.
- 한 번에 너무 많은 문제(예: 20개)를 생성하면 API 처리 시간과 DOM 조작 시간이 길어질 수 있습니다.

## 파일 구조

```
extension/
├── manifest.json   # MV3 매니페스트
├── background.js   # Gemini API 호출 및 오케스트레이션
├── content.js       # forms.office.com DOM 자동화
├── popup.html/js    # 사용자 입력 UI
└── options.html/js  # API 키 설정
```
