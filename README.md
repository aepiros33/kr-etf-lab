# KR ETF Lab

한국거래소(KRX)에 상장된 ETF로 포트폴리오를 구성하고 과거 수익률을 보는 웹 시뮬레이터입니다. 가격 시뮬은 **수정주가 기준(분배금 세전 재투자 효과 포함) · 세금 미반영 · 과거 시뮬**입니다.

「배당 현금흐름」 탭은 **원가격 + 실제 분배금**(국내: KRX KIND 공시, 미국 직투 비교: 발행사·Nasdaq·stockanalysis·Yahoo 대조)으로 월별 분배금(배당락일 기준 집계, 세전/세후), 연도별 합계, TTM 월평균(월평균 = TTM÷12), 총수익률·MDD를 따로 계산합니다.

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
- **배당 현금흐름 모드**: 분배금 인출/재투자, 세후/세전 막대, 일반계좌 원천세(미국 직투 15%, 국내상장 15.4%), 환율 효과 분리, 「데이터 없음」·「미확인」 구분. 데이터 갱신 `python3 agents/div_ingest.py`

## 에이전트 역할

| 역할 | 파일 | 하는 일 |
|---|---|---|
| Fast | `agents/fast_ingest.py` | ETF 목록·일별 종가 수집 (해석 금지) |
| Build | `agents/build_backtest.py`, `app.js` | 백테스트 엔진과 화면 (숫자 계산은 여기만) |
| Review | `agents/reviewer.py` + 화면 리뷰 패널 | 불변식 검사, 한계 고지 |

## 한계

- 가격 시뮬은 KRX 상장 ETF만. 미국 상장 ETF(SCHD 등)는 배당 모드의 「해외 직투 비교」 그룹에서만 비교용으로 제공
- 가격 시뮬은 **수정주가 기준**: 분배금(세전) 재투자 효과는 이미 포함, 세금·슬리피지는 미반영(거래비용은 회전율×비용률로 차감)
- 배당 모드는 일반계좌 분배금 원천세만 반영(ISA·연금, 매매차익 과세, 금융소득종합과세는 미반영 · 안내만)
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
