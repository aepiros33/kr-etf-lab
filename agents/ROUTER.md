# Router

작업이 오면 역할만 나눈다.

- 시세·목록·포맷 변환 → Fast (`fast_ingest.py`)
- 엔진·화면·프리셋 → Build (`build_backtest.py`, `index.html`, `app.js`)
- 숫자 검증·해석 문장 → Review (`reviewer.py`, 화면 리뷰 패널)

숫자 계산은 모델이 하지 않는다. 파이썬/브라우저 엔진이 계산하고, 리뷰어는 불변식만 본다.

불변식
- 단일 ETF 바이앤홀드 수익률 = 첫날 종가 대비 마지막 종가
- MDD ≤ 0
- 가격은 양수
- 공통 기간 20거래일 미만이면 실패
