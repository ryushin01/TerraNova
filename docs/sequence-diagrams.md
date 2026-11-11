# 시퀀스 다이어그램

TerraNova의 주요 흐름입니다. 웹(Next.js)은 Socket.IO로 백엔드(Bun)와 이어지고, 백엔드는 MQTT 브로커(Aedes)로 장비(개발에서는 시뮬레이터)와 주고받습니다. 지켜야 할 규칙은 [설계와 안전 규칙](design.md)에 있습니다.

## 1. 정시 알람과 확인 후 급수

```mermaid
sequenceDiagram
    actor 작업자
    participant 웹 as 웹 화면
    participant 백엔드 as 백엔드<br/>(WateringService)
    participant DB as PGlite<br/>(watering_cycles)
    participant 푸시 as Web Push
    participant 브로커 as MQTT 브로커
    participant 장비 as 장비 (펌프)

    백엔드->>DB: 섹션의 알람 시각이 되면 급수 주기 추가 (alarm_sent)
    Note over DB: 구역마다 진행 중인 급수는 하나 (부분 유니크 인덱스)
    백엔드->>웹: Socket.IO cycle:update
    백엔드->>푸시: 화면을 닫아 둔 사람에게 알림
    alt 아무도 확인하지 않음
        백엔드->>웹: 10분마다 다시 알림
        백엔드->>DB: 30분 지나면 timed_out (물을 주지 않음)
    else 작업자가 확인
        작업자->>웹: 확인하고 물 주기 (여러 개면 "모두 확인")
        웹->>백엔드: 세션과 역할을 다시 확인
        백엔드->>DB: alarm_sent → confirmed (여러 사람이 눌러도 한 번만)
        alt 장비 오프라인
            백엔드->>DB: failed (zone_offline)
        else 토양 수분 70% 이상
            백엔드->>DB: skipped (soil_sufficient)
        else
            백엔드->>DB: confirmed → command_sent
            백엔드->>브로커: …/actuators/pump/command { commandId, on, durationSec }
            브로커->>장비: 명령 (같은 commandId는 다시 실행하지 않음)
            장비-->>브로커: …/pump/ack accepted → completed
            브로커-->>백엔드: ack
            백엔드->>DB: watering → completed (응답 없으면 failed + 중지 명령)
        end
        백엔드->>웹: cycle:update (카드 색은 장비 응답에 따라 바뀜)
    end
    Note over 장비: 펌프는 장비 쪽에서도 최대 300초 뒤 스스로 멈춤
```

## 2. 센서 값과 자동 제어

자동 제어는 환기와 조명만 움직이며, 펌프에 명령할 방법이 없습니다.

```mermaid
sequenceDiagram
    participant 장비 as 장비 (센서)
    participant 브로커 as MQTT 브로커
    participant 백엔드 as 백엔드<br/>(zones, Automation)
    participant 웹 as 웹 화면
    actor 작업자

    장비->>브로커: …/telemetry (온도, 습도, 토양 수분)
    브로커->>백엔드: 구독 (terranova/zones/+/telemetry)
    백엔드->>백엔드: 형식 검사(parseTelemetry), 구역 상태 갱신
    백엔드->>웹: zone:update
    백엔드->>백엔드: desiredVent(온도·습도), desiredLight(시각)
    alt 최근 30분 안에 사람이 스위치를 바꿈
        백엔드-->>백엔드: 그 장치는 규칙을 따르지 않음
    else 바꿀 필요가 있음
        백엔드->>브로커: …/actuators/vent|light/command
        브로커->>장비: 명령
        Note over 백엔드: 제어 이력에 "자동 제어"로 기록
    end
    opt 토양 수분이 정한 값 아래
        백엔드->>웹: 알람만 (6시간에 한 번, 물은 주지 않음)
    end
    작업자->>웹: 환기·조명 스위치 직접 변경
    웹->>백엔드: 세션·역할 확인 후 명령, 30분 동안 자동 제어 멈춤
```
