# KR ETF Lab

한국거래소에 상장된 ETF만으로 포트폴리오를 구성하고, 과거 가격 수익률을 보는 웹 시뮬레이터.

저장소: https://github.com/aepiros33/kr-etf-lab

Grok Bot이 이어서 작업하려면 `AGENTS.md`와 `GROK_BOT_PROMPT.md`를 열어라.

## 실행

```bash
pip install -r requirements.txt
python3 agents/fast_ingest.py
python3 agents/reviewer.py
python3 serve.py
# http://127.0.0.1:8765
```

## 에이전트 역할

| 역할 | 파일 | 하는 일 |
|---|---|---|
| Fast | `agents/fast_ingest.py` | ETF 목록·일별 종가 수집 |
| Build | `agents/build_backtest.py`, `app.js` | 백테스트 엔진과 화면 |
| Review | `agents/reviewer.py` + 화면 오른쪽 해석 | 숫자 이상치 검사, 한계 고지 |

## 한계

- KRX 상장 ETF만 (해외 직접 매수 VOO 등은 제외)
- 가격 수익률. 분배금 재투자·세금·수수료 미반영
- 투자 자문 아님
