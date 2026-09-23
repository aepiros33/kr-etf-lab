# Grok Build로 이 프로젝트 열기

Grok Build는 이 채팅이 아니다. 네 컴퓨터 터미널에서 코드를 고치는 CLI다.

## 1. 설치

macOS / Linux / Git Bash:

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
grok --version
```

Windows PowerShell:

```powershell
irm https://x.ai/cli/install.ps1 | iex
```

터미널을 한 번 닫았다 다시 열어 PATH가 잡히게 한다.

## 2. 로그인

둘 중 하나.

브라우저 로그인 (SuperGrok 또는 X Premium+):

```bash
grok
```

처음 실행하면 브라우저가 열린다. 그 계정으로 로그인.

API 키 (https://console.x.ai 에서 발급):

```bash
export XAI_API_KEY="xai-..."
grok
```

구독 로그인과 API 키 과금은 별도다.

## 3. 이 저장소에서 켜기

```bash
git clone https://github.com/aepiros33/kr-etf-lab
cd kr-etf-lab
pip install -r requirements.txt
python3 agents/fast_ingest.py
grok
```

열린 다음 이 문장을 붙여라:

```
AGENTS.md를 읽고 이 저장소 작업을 이어라.
지금은 KRX ETF 포트 시뮬레이터다.
숫자를 LLM이 계산하지 말고 app.js / agents/build_backtest.py가 계산하게 해라.
이번 작업: ETF 검색, 카테고리 필터, 월 적립(DCA).
python3 agents/reviewer.py가 PASS여야 한다.
증권사 실거래 API와 투자 자문 문장은 넣지 마라.
```

## 4. 확인

```bash
python3 serve.py
```

브라우저에서 http://127.0.0.1:8765
