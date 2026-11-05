import {
  type AddCropResult,
  type ClientToServerEvents,
  type ConfirmResult,
  type ControlResult,
  canControl,
  isManualActuator,
  isZoneId,
  normalizeAlarmTimes,
  type RemoveCropResult,
  type ServerToClientEvents,
} from "@terranova/shared";
import { fromNodeHeaders } from "better-auth/node";
import type { Server, Socket } from "socket.io";
import type { AppOptions } from "./app";
import type { Auth } from "./auth";
import type { Automation } from "./automation";
import type { DeviceControls } from "./controls";
import { type Actor, type ControlHistory, type HistoryEvent, outcomeOf } from "./history";
import type { ZoneSections } from "./sections";
import type { WateringService } from "./watering";
import type { ZoneRegistry } from "./zones";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SocketDeps {
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  options: AppOptions;
  auth: Auth;
  zones: ZoneRegistry;
  sections: ZoneSections;
  history: ControlHistory;
  watering: WateringService;
  controls: DeviceControls;
  automation: Automation;
}

/** Who may connect, and what connected people may do. Returns a function that stops its timer. */
export function registerSocketHandlers({
  io,
  options,
  auth,
  zones,
  sections,
  history,
  watering,
  controls,
  automation,
}: SocketDeps) {
  // Sessions are read again for every action, so sign-out, removal or a role change applies at once.
  const sessionOf = (socket: Socket) =>
    auth.api.getSession({
      headers: fromNodeHeaders(socket.request.headers),
      query: { disableRefresh: true },
    });

  /**
   * Runs an action only for a signed-in person whose role allows it, and records the attempt,
   * refused ones included. Recording happens on the side so it can never delay or block the action.
   */
  const whenAllowed = async <T extends { ok: boolean }>(
    socket: Socket,
    forbidden: T,
    describe: (result: T) => HistoryEvent[] | Promise<HistoryEvent[]>,
    action: (actor: Actor) => Promise<T>,
  ): Promise<T> => {
    const current = await sessionOf(socket);
    if (!current) {
      socket.disconnect(true);
      return forbidden;
    }
    const actor: Actor = { id: current.user.id, name: current.user.name, role: current.user.role };
    const log = (result: T) => {
      Promise.resolve(result)
        .then(describe)
        .then((events) => history.record(actor, events))
        .catch((error) => console.error("[history] could not describe:", error));
    };
    try {
      const result = canControl(current.user.role) ? await action(actor) : forbidden;
      log(result);
      return result;
    } catch (error) {
      log({ ok: false, error: "internal" } as unknown as T);
      throw error;
    }
  };

  const cropRef = async (cropId: string) => {
    const crop = (await sections.crops()).find(({ id }) => id === cropId);
    return crop ? { id: crop.id, name: crop.name } : { id: cropId, name: cropId };
  };

  io.use((socket, next) => {
    sessionOf(socket).then(
      (current) => next(current ? undefined : new Error("unauthorized")),
      () => next(new Error("unauthorized")),
    );
  });

  io.on("connection", (socket) => {
    Promise.all([watering.latestCycles(), sections.crops(), sections.assignments()])
      .then(([cycles, crops, assigned]) =>
        socket.emit("snapshot", {
          automationPauses: automation.pauses(Date.now()),
          crops,
          timeZone: options.watering.timeZone,
          sections: assigned,
          zones: zones.all(Date.now()),
          cycles,
        }),
      )
      .catch((error) => console.error("[server] snapshot failed:", error));

    socket.on("alarm:confirm", (cycleId, callback) => {
      if (typeof callback !== "function") return;
      if (typeof cycleId !== "string" || !UUID_PATTERN.test(cycleId)) {
        callback({ ok: false, error: "not_found" });
        return;
      }
      whenAllowed<ConfirmResult>(
        socket,
        { ok: false, error: "forbidden" },
        (result) => [
          { action: "alarm_confirm", zoneId: result.ok ? result.cycle.zoneId : undefined, ...outcomeOf(result) },
        ],
        (actor) => watering.confirm(cycleId, actor.id),
      ).then(callback, (error) => {
        console.error("[server] confirm failed:", error);
        callback({ ok: false, error: "internal" });
      });
    });

    socket.on("watering:start", (zoneId, callback) => {
      if (typeof callback !== "function") return;
      if (!isZoneId(zoneId)) {
        callback({ ok: false, error: "not_found" });
        return;
      }
      whenAllowed<ConfirmResult>(
        socket,
        { ok: false, error: "forbidden" },
        (result) => [{ action: "watering_start", zoneId, ...outcomeOf(result) }],
        (actor) => watering.startWatering(zoneId, actor.id),
      ).then(callback, (error) => {
        console.error("[server] start failed:", error);
        callback({ ok: false, error: "internal" });
      });
    });

    socket.on("zones:move", (zoneIds, cropId, callback) => {
      if (typeof callback !== "function") return;
      const valid =
        Array.isArray(zoneIds) && zoneIds.length > 0 && zoneIds.every(isZoneId) && typeof cropId === "string";
      if (!valid) {
        callback({ ok: false, error: "invalid" });
        return;
      }
      whenAllowed<ControlResult>(
        socket,
        { ok: false, error: "forbidden" },
        async (result) => {
          const crop = await cropRef(cropId);
          return zoneIds.map((zoneId) => ({ action: "zones_move", zoneId, detail: { crop }, ...outcomeOf(result) }));
        },
        async () => {
          if (!(await sections.move(zoneIds, cropId))) return { ok: false, error: "invalid" };
          io.emit("sections:update", await sections.assignments());
          return { ok: true };
        },
      ).then(callback, () => callback({ ok: false, error: "internal" }));
    });

    socket.on("crop:add", (name, icon, callback) => {
      if (typeof callback !== "function") return;
      whenAllowed<AddCropResult>(
        socket,
        { ok: false, error: "forbidden" },
        (result) => [
          {
            action: "crop_add",
            detail: {
              crop: result.ok
                ? { id: result.crop.id, name: result.crop.name }
                : { id: "", name: String(name).slice(0, 60) },
            },
            ...outcomeOf(result),
          },
        ],
        async () => {
          const outcome = await sections.addCrop(name, icon);
          if ("error" in outcome) return { ok: false, error: outcome.error };
          io.emit("crops:update", await sections.crops());
          return { ok: true, crop: outcome.crop };
        },
      ).then(callback, () => callback({ ok: false, error: "internal" }));
    });

    socket.on("crop:update", (cropId, name, icon, callback) => {
      if (typeof callback !== "function") return;
      if (typeof cropId !== "string") {
        callback({ ok: false, error: "invalid" });
        return;
      }
      // Read first: afterwards the old name is gone. A refused edit records the name it tried.
      const before = cropRef(cropId);
      whenAllowed<AddCropResult>(
        socket,
        { ok: false, error: "forbidden" },
        async (result) => [
          {
            action: "crop_edit",
            detail: {
              crop: { id: cropId, name: result.ok ? result.crop.name : String(name).slice(0, 60) },
              previousName: (await before).name,
            },
            ...outcomeOf(result),
          },
        ],
        async () => {
          await before;
          const outcome = await sections.updateCrop(cropId, name, icon);
          if ("error" in outcome) return { ok: false, error: outcome.error };
          io.emit("crops:update", await sections.crops());
          return { ok: true, crop: outcome.crop };
        },
      ).then(callback, () => callback({ ok: false, error: "internal" }));
    });

    socket.on("crop:automation", (cropId, rules, callback) => {
      if (typeof callback !== "function") return;
      if (typeof cropId !== "string") {
        callback({ ok: false, error: "invalid" });
        return;
      }
      whenAllowed<ControlResult>(
        socket,
        { ok: false, error: "forbidden" },
        async (result) => [
          { action: "automation_change", detail: { crop: await cropRef(cropId) }, ...outcomeOf(result) },
        ],
        async () => {
          if (!(await sections.setAutomation(cropId, rules))) return { ok: false, error: "invalid" };
          io.emit("crops:update", await sections.crops());
          return { ok: true };
        },
      ).then(callback, () => callback({ ok: false, error: "internal" }));
    });

    socket.on("automation:resume", (zoneId, actuator, callback) => {
      if (typeof callback !== "function") return;
      if (!isZoneId(zoneId) || !isManualActuator(actuator)) {
        callback({ ok: false, error: "invalid" });
        return;
      }
      whenAllowed<ControlResult>(
        socket,
        { ok: false, error: "forbidden" },
        (result) => [{ action: "automation_resume", zoneId, detail: { actuator }, ...outcomeOf(result) }],
        async () => {
          automation.resume(zoneId, actuator);
          io.emit("automation:pauses", automation.pauses(Date.now()));
          return { ok: true };
        },
      ).then(callback, () => callback({ ok: false, error: "internal" }));
    });

    socket.on("crops:reorder", (cropIds, callback) => {
      if (typeof callback !== "function") return;
      whenAllowed<ControlResult>(
        socket,
        { ok: false, error: "forbidden" },
        (result) => [{ action: "crops_reorder", ...outcomeOf(result) }],
        async () => {
          if (!(await sections.reorder(cropIds))) return { ok: false, error: "invalid" };
          io.emit("crops:update", await sections.crops());
          return { ok: true };
        },
      ).then(callback, () => callback({ ok: false, error: "internal" }));
    });

    socket.on("crop:schedule", (cropId, times, callback) => {
      if (typeof callback !== "function") return;
      if (typeof cropId !== "string") {
        callback({ ok: false, error: "invalid" });
        return;
      }
      whenAllowed<ControlResult>(
        socket,
        { ok: false, error: "forbidden" },
        async (result) => [
          {
            action: "alarm_times",
            detail: { crop: await cropRef(cropId), times: normalizeAlarmTimes(times) ?? undefined },
            ...outcomeOf(result),
          },
        ],
        async () => {
          if (!(await sections.setAlarmTimes(cropId, times))) return { ok: false, error: "invalid" };
          io.emit("crops:update", await sections.crops());
          return { ok: true };
        },
      ).then(callback, () => callback({ ok: false, error: "internal" }));
    });

    socket.on("crop:remove", (cropId, callback) => {
      if (typeof callback !== "function") return;
      if (typeof cropId !== "string") {
        callback({ ok: false, error: "not_found" });
        return;
      }
      // Looked up first: after removal the name is gone.
      const crop = cropRef(cropId);
      whenAllowed<RemoveCropResult>(
        socket,
        { ok: false, error: "forbidden" },
        async (result) => [{ action: "crop_remove", detail: { crop: await crop }, ...outcomeOf(result) }],
        async () => {
          await crop;
          const outcome = await sections.removeCrop(cropId);
          if (outcome !== "ok") return { ok: false, error: outcome };
          io.emit("crops:update", await sections.crops());
          return { ok: true };
        },
      ).then(callback, () => callback({ ok: false, error: "internal" }));
    });

    socket.on("pump:stop", (zoneId, callback) => {
      if (typeof callback !== "function") return;
      if (!isZoneId(zoneId)) {
        callback({ ok: false, error: "invalid" });
        return;
      }
      whenAllowed<ControlResult>(
        socket,
        { ok: false, error: "forbidden" },
        (result) => [{ action: "pump_stop", zoneId, ...outcomeOf(result) }],
        () => controls.stopPump(zoneId),
      ).then(callback, () => callback({ ok: false, error: "internal" }));
    });

    socket.on("actuator:set", (zoneId, actuator, on, callback) => {
      if (typeof callback !== "function") return;
      if (!isZoneId(zoneId) || !isManualActuator(actuator) || typeof on !== "boolean") {
        callback({ ok: false, error: "invalid" });
        return;
      }
      whenAllowed<ControlResult>(
        socket,
        { ok: false, error: "forbidden" },
        (result) => [{ action: "actuator_set", zoneId, detail: { actuator, on }, ...outcomeOf(result) }],
        async () => {
          const result = await controls.setActuator(zoneId, actuator, on);
          if (result.ok) {
            automation.noteManualChange(zoneId, actuator, Date.now());
            io.emit("automation:pauses", automation.pauses(Date.now()));
          }
          return result;
        },
      ).then(callback, () => callback({ ok: false, error: "internal" }));
    });
  });

  // Live data must also stop for someone signed out or removed while their page stays open.
  let sweeping = false;
  const sessionSweep = setInterval(async () => {
    if (sweeping) return;
    sweeping = true;
    for (const socket of io.sockets.sockets.values()) {
      const current = await sessionOf(socket).catch(() => undefined);
      if (current === null) socket.disconnect(true);
    }
    sweeping = false;
  }, options.sessionSweepMs);

  return () => clearInterval(sessionSweep);
}
