# KR ETF Lab

한국거래소(KRX)에 상장된 ETF만으로 포트폴리오를 구성하고, 과거 **가격 수익률**을 보는 웹 시뮬레이터입니다.

저장소: https://github.com/aepiros33/kr-etf-lab

이어 작업하려면 `AGENTS.md`와 `GROK_BOT_PROMPT.md`를 먼저 읽으세요.

## 실행

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python3 agents/fast_ingest.py          # 시총 상위 ~80개 메타 + 종가 수집
python3 agents/reviewer.py             # PASS 확인
python3 serve.py
# 브라우저: http://127.0.0.1:8765
```

시세 파일(`data/etf_prices.json`, `data/prices/*.json`)은 용량 때문에 git에 넣지 않습니다. ingest로 로컬에 생성하세요.

## 주요 기능

- **검색·카테고리 필터**: 왼쪽 사이드바에서 이름/코드/운용사 검색, 국내주식·해외주식·테마·채권·원자재·현금성 필터
- **선택 종목만 시세 로드**: 메타(`etf_meta.json`)는 전체, 종가는 `data/prices/{코드}.json`을 필요한 종목 + 벤치마크 `069500`만 fetch
- **월 적립(DCA)**: 시작 원금 + 매월 금액. 매월 첫 거래일에 현금 유입 후 목표 비중으로 매수
- **리밸런싱**: 당일 평가(mark-to-market) 후 비중 재조정 (리밸런싱 날 수익률을 지우지 않음)
- **모바일**: 좁은 화면에서 사이드바가 결과 위로 쌓임

## 에이전트 역할

| 역할 | 파일 | 하는 일 |
|---|---|---|
| Fast | `agents/fast_ingest.py` | ETF 목록·일별 종가 수집 (해석 금지) |
| Build | `agents/build_backtest.py`, `app.js` | 백테스트 엔진과 화면 (숫자 계산은 여기만) |
| Review | `agents/reviewer.py` + 화면 리뷰 패널 | 불변식 검사, 한계 고지 |

## 한계

- KRX 상장 ETF만 (해외 직구 VOO 등은 제외)
- **가격 수익률** 기준. 분배금 재투자·세금·매매 수수료·슬리피지 미반영
- 월 적립 연환산·누적 수익률은 **납입 원금 합 대비** 단순 계산 (시간가중과 다를 수 있음)
- 레버리지/인버스는 목록에 포함될 수 있으나 기본 프리셋에는 넣지 않음
- FinanceDataReader(KRX/네이버) 종가. 수집 중 rate limit이 나면 잠시 후 재실행
- **투자 자문이 아닙니다.** 과거 수익률은 미래 수익을 보장하지 않습니다.
- 증권사 주문 API 연동은 하지 않습니다.

## 검수

```bash
python3 agents/reviewer.py
# PASS 가 나와야 UI 변경을 머지합니다.
```
