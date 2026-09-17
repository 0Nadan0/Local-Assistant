# Gate 1 프로토타입 — 설치·배포 안내

폰에서 앱처럼 쓰는 웹페이지다. 참여자는 링크 하나만 받아 열면 된다 (설치·로그인 없음).
이용 기록은 구글 시트에 쌓이고, 끝나면 `scripts/analyze_gate1.py`로 판정 숫자를 뽑는다.

```
gate1-prototype/
├── index.html · app.css · app.js   화면 (고칠 일 거의 없음)
├── config.js                       ★ 배포 전에 여기만 고친다 (기록 받을 주소)
├── data/items.json                 보여줄 소식 145건 (scripts/export_gate1.py가 만든다)
├── apps-script/Code.gs             구글 시트에 붙일 기록 수신 코드
├── icon.svg · manifest.webmanifest 홈 화면에 추가했을 때 아이콘
```

준비물: 구글 계정, GitHub 계정(무료). 전부 사용자가 직접 한다 — 계정 만들기·공개 배포는 대신하지 않는다.

---

## 1단계 — 내 PC에서 먼저 보기 (5분)

Claude 데스크톱 앱 오른쪽 브라우저 창에 이미 떠 있다 (`http://localhost:8765`).
직접 띄우려면 터미널에서:

```bash
python -m http.server 8765 --directory gate1-prototype
```

브라우저에서 `http://localhost:8765/?p=TEST01` 을 연다. `TEST`로 시작하는 코드는 분석에서 자동으로 빠진다.

## 2단계 — 기록 받을 구글 시트 만들기 (10분)

1. [sheets.new](https://sheets.new) 로 새 스프레드시트를 만들고 이름을 `Gate1 이용기록`으로 바꾼다
2. 메뉴 **확장 프로그램 → Apps Script**
3. 왼쪽 `Code.gs` 내용을 전부 지우고, 이 폴더의 `apps-script/Code.gs` 내용을 붙여 넣고 저장(💾)
4. 오른쪽 위 **배포 → 새 배포**
   - 톱니바퀴 → **웹 앱** 선택
   - 실행 사용자: **나**
   - 액세스 권한: **모든 사용자** (참여자 폰에서 로그인 없이 보내야 하므로)
5. **배포** → 구글 계정 권한 허용 → 나오는 **웹 앱 URL**(`https://script.google.com/macros/s/…/exec`)을 복사
6. 그 주소를 브라우저 새 탭에 붙여 넣어 열어 본다 → `{"ok":true,...}` 가 보이면 성공

> 액세스 "모든 사용자"는 주소를 아는 사람이 기록을 **보낼** 수 있다는 뜻이다. 시트를 **볼** 수 있는 건 여전히 나뿐이다.
> 아무나 섞어 보내는 것을 막기 위해 `STUDY_KEY`가 맞는 기록만 받는다.

## 3단계 — config.js에 주소 넣기 (1분)

`config.js`의 `ENDPOINT: ""` 따옴표 안에 5번에서 복사한 주소를 넣는다.
PC 미리보기에서 소식 몇 개를 눌러 보고 → 1분 뒤 시트에 `events` 탭과 줄이 생기면 연결 완료.

## 4단계 — GitHub Pages로 공개 링크 만들기 (15분)

1. [github.com/new](https://github.com/new) 에서 저장소 만들기
   - 이름 예: `dongne-gate1` · **Public** (무료 Pages는 공개 저장소만 된다)
   - 소식 데이터는 전부 공공기관 공개 정보라 공개해도 문제없다. 기록(시트)은 GitHub에 올라가지 않는다
2. 만든 저장소 화면에서 **uploading an existing file** 클릭
3. `gate1-prototype` 폴더 **안의 파일과 폴더 전부**를 끌어다 놓는다 (`apps-script` 폴더는 빼도 된다) → **Commit changes**
4. 저장소 **Settings → Pages** → Branch: `main` / `(root)` → **Save**
5. 1~2분 뒤 같은 화면 위쪽에 `https://<아이디>.github.io/dongne-gate1/` 주소가 뜬다

## 5단계 — 참여자 링크 보내기

참여자마다 코드를 붙인 링크를 따로 보낸다. 코드는 이름이 아니라 번호로.

```
https://<아이디>.github.io/dongne-gate1/?p=A01
https://<아이디>.github.io/dongne-gate1/?p=A02
...
```

- 본인축(50~70대 본인)은 `A01~A15`, 가족축(자녀가 부모 대신)은 `F01~F15`처럼 나누면 분석이 쉽다
- 누가 어떤 코드인지는 **내 수첩에만** 적는다. 시트에는 코드만 남는다
- 안내 문구 예: "동네 소식 앱 시범 참여 링크예요. 열어서 사는 동·나이대만 고르면 됩니다. 2주 동안 생각날 때 열어 봐 주세요. 홈 화면에 추가하면 앱처럼 쓸 수 있어요."

## 소식 데이터 새로 고치기 (주 1회 권장)

```bash
python src/run_src014.py --from 2026-09-01 --to 2026-12-31
python src/run_src002.py --from 2026-08-01 --to <오늘>
python src/run_src006.py --from 2026-08-01 --to <오늘>
python src/run_src022.py --from <오늘> --to 2026-12-31
```

수집기는 `data/normalized/`에 쓰므로, 끝나면 4개 CSV를 `data/gate1/normalized/`로 옮기고
Gate 0 원본은 `data/snapshots/gate0_2026-06_08/`에서 되돌린다. 이어서:

```bash
python scripts/merge_dedupe.py --write --dir data/gate1/normalized
python scripts/apply_labels.py --csv data/gate1/normalized/content_all.csv --labels data/gate1/labels.jsonl
python scripts/ai_judge.py --src data/gate1/normalized/content_all.csv --out data/gate1/ai_judgment.csv
python scripts/export_gate1.py
```

새 구청·보건소 글은 `labels.jsonl`에 쉬운 제목·날짜·대상을 채워야 앱에서 제대로 보인다 (merge 후 content_id가 바뀌므로 id를 다시 맞출 것).
바뀐 `data/items.json`만 GitHub 저장소에 다시 올리면 참여자 화면에 반영된다.

## 끝난 뒤 — 판정

시트 `events` 탭 → **파일 → 다운로드 → CSV** → `data/gate1/events.csv`로 저장

```bash
python scripts/analyze_gate1.py data/gate1/events.csv
```

판정 기준은 `docs/gate1-plan.md` 3항이다. **참여자 모집 전에 확정**하고, 결과를 본 뒤 고치지 않는다.
