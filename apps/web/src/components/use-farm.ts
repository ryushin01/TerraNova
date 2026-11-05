"use client";

import {
  DEFAULT_SOCKET_PORT,
  type ClientToServerEvents,
  type AddCropResult,
  type ConfirmResult,
  type Crop,
  type CropIconKey,
  type RemoveCropResult,
  type ControlResult,
  type ManualActuator,
  type ServerToClientEvents,
  type WateringCycle,
  type ZoneSnapshot,
} from "@terranova/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { authClient } from "@/lib/auth-client";

const REQUEST_TIMEOUT_MS = 10_000;

type FarmSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type Connection = "connecting" | "connected" | "disconnected";

/**
 * In development the backend is a separate port on the same host, and the session cookie only
 * goes to the host that set it. In network mode everything comes through one address.
 */
const socketUrl = () =>
  window.location.port === "3000"
    ? `${window.location.protocol}//${window.location.hostname}:${DEFAULT_SOCKET_PORT}`
    : window.location.origin;

export function useFarm(onSignedOut: () => void, onCycleUpdate?: (cycle: WateringCycle) => void) {
  const socketRef = useRef<FarmSocket | null>(null);
  const onSignedOutRef = useRef(onSignedOut);
  onSignedOutRef.current = onSignedOut;
  const onCycleUpdateRef = useRef(onCycleUpdate);
  onCycleUpdateRef.current = onCycleUpdate;
  const [connection, setConnection] = useState<Connection>("connecting");
  const [crops, setCrops] = useState<Crop[]>([]);
  const [timeZone, setTimeZone] = useState("");
  const [sections, setSections] = useState<Record<string, string>>({});
  const [zones, setZones] = useState<Record<string, ZoneSnapshot>>({});
  const [cycles, setCycles] = useState<Record<string, WateringCycle>>({});

  useEffect(() => {
    const socket: FarmSocket = io(socketUrl(), { withCredentials: true });
    socketRef.current = socket;

    socket.on("connect", () => setConnection("connected"));
    socket.on("disconnect", (reason) => {
      setConnection("disconnected");
      if (reason !== "io server disconnect") return;
      // The server hung up on this connection's session. Changing your own password replaces the
      // session, so if a valid one exists, reconnect with it instead of signing out.
      authClient
        .getSession()
        .then(({ data }) => (data ? socket.connect() : onSignedOutRef.current()))
        .catch(() => socket.connect());
    });
    socket.on("connect_error", (error) => {
      setConnection("disconnected");
      if (error.message === "unauthorized") onSignedOutRef.current();
    });
    socket.on("crops:update", setCrops);
    socket.on("sections:update", setSections);
    socket.on("snapshot", (snapshot) => {
      setCrops(snapshot.crops);
      setTimeZone(snapshot.timeZone);
      setSections(snapshot.sections);
      setZones(Object.fromEntries(snapshot.zones.map((zone) => [zone.zoneId, zone])));
      setCycles(Object.fromEntries(snapshot.cycles.map((cycle) => [cycle.zoneId, cycle])));
    });
    socket.on("zone:update", (zone) => setZones((prev) => ({ ...prev, [zone.zoneId]: zone })));
    socket.on("cycle:update", (cycle) => {
      setCycles((prev) => ({ ...prev, [cycle.zoneId]: cycle }));
      onCycleUpdateRef.current?.(cycle);
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, []);

  const request = useCallback(
    async <T extends ConfirmResult | ControlResult | AddCropResult | RemoveCropResult>(send: (socket: FarmSocket) => Promise<T>) => {
      const socket = socketRef.current;
      if (!socket?.connected) return { ok: false, error: "internal" } as T;
      try {
        return await send(socket);
      } catch {
        return { ok: false, error: "internal" } as T;
      }
    },
    [],
  );

  const confirmAlarm = useCallback(
    (cycleId: string) =>
      request<ConfirmResult>((s) => s.timeout(REQUEST_TIMEOUT_MS).emitWithAck("alarm:confirm", cycleId)),
    [request],
  );
  const startWatering = useCallback(
    (zoneId: string) =>
      request<ConfirmResult>((s) => s.timeout(REQUEST_TIMEOUT_MS).emitWithAck("watering:start", zoneId)),
    [request],
  );
  const moveZones = useCallback(
    (zoneIds: string[], cropId: string) =>
      request<ControlResult>((s) => s.timeout(REQUEST_TIMEOUT_MS).emitWithAck("zones:move", zoneIds, cropId)),
    [request],
  );
  const addCrop = useCallback(
    (name: string, icon: CropIconKey) =>
      request<AddCropResult>((s) => s.timeout(REQUEST_TIMEOUT_MS).emitWithAck("crop:add", name, icon)),
    [request],
  );
  const updateCrop = useCallback(
    (cropId: string, name: string, icon: CropIconKey) =>
      request<AddCropResult>((s) => s.timeout(REQUEST_TIMEOUT_MS).emitWithAck("crop:update", cropId, name, icon)),
    [request],
  );
  const reorderCrops = useCallback(
    (cropIds: string[]) =>
      request<ControlResult>((s) => s.timeout(REQUEST_TIMEOUT_MS).emitWithAck("crops:reorder", cropIds)),
    [request],
  );
  const setAlarmTimes = useCallback(
    (cropId: string, times: string[]) =>
      request<ControlResult>((s) => s.timeout(REQUEST_TIMEOUT_MS).emitWithAck("crop:schedule", cropId, times)),
    [request],
  );
  const removeCrop = useCallback(
    (cropId: string) =>
      request<RemoveCropResult>((s) => s.timeout(REQUEST_TIMEOUT_MS).emitWithAck("crop:remove", cropId)),
    [request],
  );
  const stopPump = useCallback(
    (zoneId: string) =>
      request<ControlResult>((s) => s.timeout(REQUEST_TIMEOUT_MS).emitWithAck("pump:stop", zoneId)),
    [request],
  );
  const setActuator = useCallback(
    (zoneId: string, actuator: ManualActuator, on: boolean) =>
      request<ControlResult>((s) =>
        s.timeout(REQUEST_TIMEOUT_MS).emitWithAck("actuator:set", zoneId, actuator, on),
      ),
    [request],
  );

  return { connection, crops, timeZone, sections, zones, cycles, confirmAlarm, startWatering, moveZones, addCrop, updateCrop, reorderCrops, setAlarmTimes, removeCrop, stopPump, setActuator };
}
