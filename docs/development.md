# 개발 가이드

## 명령

| 명령 | 용도 |
|---|---|
| `bun run lan` | 휴대폰과 태블릿에서 접속하는 네트워크 모드 |
| `bun test` | 단위, 통합 테스트 |
| `bun run typecheck` | 타입 검사 |
| `bun run lint` | 린트와 포맷 검사 (Biome) |
| `bun run format` | 포맷 적용과 자동 수정 |
| `bun run build` | 웹 프로덕션 빌드 |
| `bun run test:e2e` | 실제 브라우저 테스트 |
| `bun run test:lan` | 네트워크 모드 테스트 |
| `bun run docs:screenshots` | 문서의 화면 이미지 다시 촬영 (`docs/images`) |
| `bun run db:generate` (`apps/server`에서) | 스키마 변경 후 마이그레이션 생성 |

알람을 바로 시험하려면 다음을 실행합니다. `/dev` 경로는 `NODE_ENV=production`에서는 꺼집니다.

```sh
curl -X POST http://localhost:4000/dev/alarms/zone-a
```

관리자 비밀번호 복구 명령은 [기능 문서](features.md#계정과-권한)를 봅니다.

## 구조

```text
시뮬레이터(장비) ⇄ MQTT ⇄ 백엔드(브로커 내장, 스케줄러, 로그인, PGlite) ⇄ Socket.IO ⇄ 웹
```

| 경로 | 역할 |
|---|---|
| `apps/web` | Next.js 대시보드 (Chakra UI, next-intl) |
| `apps/server` | MQTT 브로커, Socket.IO, 급수 흐름과 스케줄러, 자동 제어, Better Auth, PGlite DB |
| `apps/simulator` | 구역 6개의 센서와 펌프, 환기, 조명 시뮬레이터 |
| `apps/lan` | 네트워크 모드의 HTTPS 프록시와 실행기 |
| `packages/shared` | 장비, 백엔드, 웹이 공유하는 규약과 타입, 작물 아이콘 키워드 |
| `e2e` | Playwright 브라우저 테스트, 메모리 측정, 스크린샷 스크립트 |

웹의 `/api/*` 요청은 Next.js 리라이트로 백엔드(4000번)에 전달됩니다. 개발 모드에서 소켓은 페이지와 같은 호스트의 4000번으로 직접 연결합니다.

## 환경 변수

모두 선택 사항입니다.

| 변수 | 기본값 | 설명 |
|---|---|---|
| `WATERING_TIMES` | `08:00,18:00` | 시각을 바꾼 적 없는 섹션의 기본 알람 시각. 빈 값이면 없음 |
| `TZ_NAME` | `Asia/Seoul` | 알람 시각의 시간대 |
| `WATERING_DURATION_SEC` | `30` | 급수 시간, 1~300초 |
| `ALARM_REMIND_MIN` | `10` | 다시 알림 간격(분) |
| `ALARM_TIMEOUT_MIN` | `30` | 시간 초과까지의 시간(분) |
| `ALARM_EVERY_MIN` | 없음 | 시연용 반복 알람 간격(분) |
| `DATA_DIR` | `apps/server/.data/pglite` | DB 위치 |
| `AUTH_SECRET` | 자동 생성 | 세션 서명 키 |
| `WEB_PORT` | `3000` | 백엔드가 허용할 웹 Origin의 포트. 웹 자체의 포트는 `PORT`로 바꿈 |
| `BACKEND_PORT` | `4000` | 백엔드 포트. 웹에는 `NEXT_PUBLIC_BACKEND_PORT`, `NEXT_PUBLIC_WEB_PORT`도 함께 지정 |
| `MQTT_PORT` | `1883` | 내장 브로커 포트 |
| `LAN_PORT` | `8443` | 네트워크 모드의 HTTPS 포트 |
| `LAN_CERT_FILE`, `LAN_KEY_FILE` | 없음 | 네트워크 모드에서 쓸 신뢰된 인증서. 둘 다 지정 |
| `SENSOR_SAMPLE_SEC` | `60` | 센서 값을 기록하는 간격(초) |
| `SIM_INITIAL_SOIL` | 무작위 | 시뮬레이터 초기 토양 수분(%). 테스트에서 사용 |
| `SIM_PUMP_FAIL_RATE` | `0` | 시뮬레이터 펌프 고장 확률(0~1) |
| `SIM_SOIL_DRY_RATE` | `0.02` | 시뮬레이터 토양 건조 속도(%/초) |
| `MQTT_URL` | `mqtt://127.0.0.1:1883` | 시뮬레이터가 접속할 브로커 |

## 데이터

급수 기록, 제어 이력, 계정, 작물, 알람 시각, 구역 배치는 `apps/server/.data/pglite`에, 세션 서명 키는 `apps/server/.data/pglite-auth-secret`에, 푸시 키는 `apps/server/.data/pglite-push-keys.json`에, 네트워크 모드 인증서는 `apps/server/.data/lan-certificate`에 저장됩니다. 이 폴더는 Git에서 제외됩니다. 지우면 계정과 기록이 모두 사라집니다.

급수 기록과 제어 이력은 90일, 센서 값은 30일이 지나면 자동으로 지웁니다.

PGlite는 한 프로세스만 열 수 있으므로 DB 접근은 `apps/server`에서만 합니다.

## 테스트

| 종류 | 위치 | 내용 |
|---|---|---|
| 단위, 통합 | `apps/*/test`, `packages/shared/src/*.test.ts` | 급수 흐름, 권한, 섹션, 프록시, DB 업그레이드, 실제 MQTT와 소켓 연동 |
| 브라우저 | `e2e/*.e2e.ts` | 로그인, 급수, 메뉴, 섹션, 드래그 선택, 화면 크기, 404 화면 |
| 네트워크 모드 | `e2e/*.lan.ts` | 이 컴퓨터의 실제 IP로 접속해 노출 포트, 로그인 제한, 급수 확인 |
| 메모리 | `e2e/memory` | 같은 부하를 반복해 메모리 증가 여부 측정 |

린트, 타입 검사, 단위 테스트, 빌드, 브라우저 테스트, 네트워크 모드 테스트는 푸시와 PR마다 GitHub Actions에서도 실행됩니다.

브라우저 테스트는 설치된 Chrome을 사용합니다. 임시 DB와 전용 포트(23000번대)를 쓰므로 기존 데이터에 영향을 주지 않고, `bun run dev`를 켠 채로 실행할 수 있습니다. 두 복사본을 동시에 돌리려면 `E2E_PORT_OFFSET=100 bun run test:e2e`처럼 포트를 띄웁니다. 스펙마다 백엔드와 시뮬레이터를 직접 띄우며, 페이지 오류가 나면 해당 테스트는 실패합니다.

메모리 측정 명령은 다음과 같습니다.

```sh
bun run memory:browser                 # 프로덕션 빌드로 반복 조작 후 DOM, CSS 규칙, 소켓 수 확인
bun run memory:server [부하] [라운드]   # 기본값 all 100
bun run memory:web [라운드]             # Next.js 서버에 페이지 요청을 반복하고 RSS 측정
```

서버 측정의 부하는 `idle`, `churn`, `commands`, `cycles`, `moves`, `http`, `all`입니다. 강제 GC 후의 힙이 웜업 뒤에도 라운드마다 계속 늘면 누수를 의심합니다. 시뮬레이터 명령 캐시가 먼저 차므로 `cycles`는 약 500라운드 뒤에 평탄해집니다. 측정이 유효한지 보여 주기 위해 마지막에 일부러 메모리를 잡아 두는 대조 실험도 출력합니다.

## 메모리 관련 규칙

- 포인터를 따라 움직이는 값은 Chakra 스타일 속성이 아니라 인라인 `style`로 줍니다. 스타일 속성으로 주면 값마다 Emotion에 CSS 규칙이 영구히 쌓입니다.
- 장비가 보내는 값은 브로커 연결이 끊긴 동안 쌓지 않습니다(`queueQoSZero: false`).
- 프로세스에 오래 남는 캐시에는 상한을 둡니다. 시뮬레이터의 명령 응답 캐시는 구역당 1,000개입니다.

## 사용한 그래픽과 글꼴

- 작물 아이콘: [Fluent Emoji High Contrast](https://github.com/microsoft/fluentui-emoji) (MIT). 호박만 직접 그렸고, `apps/web/scripts/crop-icons.ts`로 `public/crops`와 설치 아이콘 `public/app-icon.svg`를 생성합니다.
- 화면 아이콘: [Lucide](https://lucide.dev) (ISC)
- 글꼴: [Pretendard](https://github.com/orioncactus/pretendard) (OFL-1.1)
