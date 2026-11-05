import { ZONE_IDS, type Telemetry, type ZoneSnapshot } from "@terranova/shared";

interface LiveZone {
  statusOnline: boolean;
  lastSeenMs: number | null;
  telemetry: Telemetry | null;
  reportedOnline: boolean;
}

/** Latest device readings. A zone counts as online only while its telemetry keeps arriving. */
export class ZoneRegistry {
  private readonly zones = new Map<string, LiveZone>(
    ZONE_IDS.map((id) => [id, { statusOnline: false, lastSeenMs: null, telemetry: null, reportedOnline: false }]),
  );

  constructor(private readonly staleAfterMs: number) {}

  /**
   * A retained message is the broker replaying an old value, which says nothing about whether
   * the device is alive, so it updates the reading but not the zone's liveness.
   */
  recordTelemetry(zoneId: string, telemetry: Telemetry, nowMs: number, retained = false): ZoneSnapshot {
    const zone = this.zones.get(zoneId)!;
    zone.telemetry = telemetry;
    if (!retained) {
      zone.lastSeenMs = nowMs;
      zone.statusOnline = true;
    }
    return this.report(zoneId, nowMs);
  }

  recordStatus(zoneId: string, online: boolean, nowMs: number): ZoneSnapshot {
    const zone = this.zones.get(zoneId)!;
    zone.statusOnline = online;
    return this.report(zoneId, nowMs);
  }

  isOnline(zoneId: string, nowMs: number): boolean {
    const zone = this.zones.get(zoneId);
    return (
      !!zone && zone.statusOnline && zone.lastSeenMs !== null && nowMs - zone.lastSeenMs <= this.staleAfterMs
    );
  }

  soilMoisture(zoneId: string): number | null {
    return this.zones.get(zoneId)?.telemetry?.soilMoisturePct ?? null;
  }

  snapshot(zoneId: string, nowMs: number): ZoneSnapshot {
    const zone = this.zones.get(zoneId)!;
    return {
      zoneId,
      online: this.isOnline(zoneId, nowMs),
      lastSeenAt: zone.lastSeenMs === null ? null : new Date(zone.lastSeenMs).toISOString(),
      telemetry: zone.telemetry,
    };
  }

  all(nowMs: number): ZoneSnapshot[] {
    return ZONE_IDS.map((id) => this.snapshot(id, nowMs));
  }

  /** Zones that went silent since the last check, so clients can be told. */
  sweepStale(nowMs: number): ZoneSnapshot[] {
    const changed: ZoneSnapshot[] = [];
    for (const [id, zone] of this.zones) {
      if (zone.reportedOnline && !this.isOnline(id, nowMs)) changed.push(this.report(id, nowMs));
    }
    return changed;
  }

  private report(zoneId: string, nowMs: number): ZoneSnapshot {
    const snapshot = this.snapshot(zoneId, nowMs);
    this.zones.get(zoneId)!.reportedOnline = snapshot.online;
    return snapshot;
  }
}
