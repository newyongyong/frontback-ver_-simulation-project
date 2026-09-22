# 생산계획 자동화 웹 버전

기존 Streamlit 프로젝트와 별도로 시작하는 웹 버전입니다.

구성은 다음과 같습니다.

```text
Next.js (사용자 화면) → FastAPI (API) → SQLite (로컬 DB 파일)
```

## 폴더

- `frontend`: Next.js 화면
- `backend`: FastAPI API와 SQLite DB
- `backend/data/production_planning.db`: 서버를 처음 실행하면 자동으로 만들어지는 DB 파일

## 처음 실행하기

### 1. Python 설치

Python 3.12 이상을 설치하고, 설치 화면에서 **Add Python to PATH**를 선택합니다.

설치 후 새 PowerShell에서 아래 명령이 동작해야 합니다.

```powershell
python --version
```

### 2. 백엔드 실행

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API 확인 주소: <http://127.0.0.1:8000/docs>

### 3. 프론트엔드 실행

새 PowerShell을 열어 실행합니다.

```powershell
cd frontend
npm install
npm run dev
```

화면 주소: <http://localhost:3000>

## 현재 포함된 기능

- FastAPI 상태 확인 API (`/health`)
- SQLite 제품 테이블 (`products`)
- 제품 목록 조회 및 제품 추가 API
- 제품을 추가하고 목록을 확인하는 Next.js 첫 화면

다음 단계는 기존 판매계획 Excel 파일을 업로드해 SQLite에 저장하는 Importer를 추가하는 것입니다.
