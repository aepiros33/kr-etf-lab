# data

시세·메타는 용량 때문에 저장소에 커밋하지 않습니다.

```bash
python3 agents/fast_ingest.py
```

생성물:

| 파일 | 설명 |
|---|---|
| `etf_meta.json` | 시총 상위 ~80개 ETF 메타 (UI 목록용, 가벼움) |
| `prices/{코드}.json` | 종목별 일별 종가 (선택 로드) |
| `etf_prices.json` | 메타+전체 종가 번들 (reviewer / 폴백) |

UI는 메타를 먼저 읽고, 선택한 종목 + 벤치마크 `069500` 시세만 로드합니다.
