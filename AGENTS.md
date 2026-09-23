# AGENTS.md — Grok Bot / Grok Build 인수인계

이 저장소를 이어 작업하라. 새 앱을 만들지 말고 여기 구조를 확장하라.

## 제품

한국거래소(KRX)에 상장된 ETF만으로 포트폴리오를 구성하고, 과거 가격 수익률을 보여주는 웹 시뮬레이터.

- 실행: `python3 serve.py` → http://127.0.0.1:8765
- 시세 갱신: `python3 agents/fast_ingest.py`
- 검수: `python3 agents/reviewer.py` 반드시 PASS 후에만 UI 변경 머지

## 역할 분리 (숫자를 모델이 계산하지 말 것)

| 역할 | 파일 | 규칙 |
|---|---|---|
| Fast | `agents/fast_ingest.py` | 목록·종가만. 해석 금지 |
| Build | `agents/build_backtest.py`, `app.js`, `index.html`, `styles.css` | 엔진과 화면. JS와 Python 로직을 같게 유지 |
| Review | `agents/reviewer.py` + 화면 리뷰 패널 | 불변식 검사. 투자 추천 문장 금지 |

## 불변식

- 단일 ETF 바이앤홀드 총수익률 = 기간 첫 종가 대비 마지막 종가
- 리밸런싱은 **당일 평가 후** 비중 재조정. 리밸런싱 날 수익률을 지우면 안 됨
- MDD ≤ 0
- 가격 > 0
- 공통 거래일 20일 미만이면 에러
- 투자 자문처럼 쓰지 말 것. 시뮬레이터 고지 유지

## 데이터

- 소스: FinanceDataReader (KRX/NAVER)
- 캐시: `data/etf_prices.json` (대용량이라 리포에 안 넣음. ingest로 생성)
- pykrx는 KRX 로그인 필요할 수 있어 기본 경로로 쓰지 말 것
- 유니버스는 일단 유동성 있는 KRX ETF. 레버리지/인버스는 태그 달고 기본 프리셋에 넣지 말 것

## 다음 작업 우선순위

1. ETF 검색 + 카테고리 필터. 목록을 늘리되 시세는 선택 종목만 로드
2. 월 적립(DCA) 시뮬레이션
3. 분배금 데이터가 있으면 총수익(TR) 토글. 없으면 가격수익 고지를 더 명확히
4. 모바일 레이아웃 다듬기
5. 증권사 주문 연동은 하지 말 것 (규제)

## 언어

UI와 커밋 메시지는 한국어. 코드 식별자는 영어.
