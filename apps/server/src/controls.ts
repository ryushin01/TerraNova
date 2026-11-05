import { randomUUID } from "node:crypto";
import { type Actuator, type CommandAck, type ControlResult, type ManualActuator, topics } from "@terranova/shared";
import type { ZoneRegistry } from "./zones";

interface ControlDeps {
  zones: ZoneRegistry;
  ackTimeoutMs: number;
  publish: (topic: string, payload: string) => Promise<void>;
  now?: () => number;
}

/** Direct device commands. A result reports what the device said, not that a message left. */
export class DeviceControls {
  private readonly pending = new Map<string, (result: ControlResult) => void>();

  constructor(private readonly deps: ControlDeps) {}

  setActuator(zoneId: string, actuator: ManualActuator, on: boolean): Promise<ControlResult> {
    if (!this.isOnline(zoneId)) return Promise.resolve({ ok: false, error: "zone_offline" });
    return this.send(zoneId, actuator, on ? "on" : "off");
  }

  /** Always tries to reach the device: a stop must not depend on our view of its status. */
  async stopPump(zoneId: string): Promise<ControlResult> {
    const result = await this.send(zoneId, "pump", "off");
    return !result.ok && !this.isOnline(zoneId) ? { ok: false, error: "zone_offline" } : result;
  }

  handleAck(ack: CommandAck): void {
    if (ack.status === "accepted") return;
    this.pending.get(ack.commandId)?.(
      ack.status === "completed" ? { ok: true } : { ok: false, error: "device_failed" },
    );
  }

  close(): void {
    for (const resolve of this.pending.values()) resolve({ ok: false, error: "internal" });
  }

  private isOnline(zoneId: string): boolean {
    return this.deps.zones.isOnline(zoneId, this.deps.now?.() ?? Date.now());
  }

  private send(zoneId: string, actuator: Actuator, action: "on" | "off"): Promise<ControlResult> {
    const commandId = randomUUID();
    return new Promise((resolve) => {
      const finish = (result: ControlResult) => {
        clearTimeout(timer);
        this.pending.delete(commandId);
        resolve(result);
      };
      const timer = setTimeout(() => finish({ ok: false, error: "no_ack" }), this.deps.ackTimeoutMs);
      this.pending.set(commandId, finish);
      this.deps
        .publish(topics.command(zoneId, actuator), JSON.stringify({ commandId, action }))
        .catch(() => finish({ ok: false, error: "internal" }));
    });
  }
}
