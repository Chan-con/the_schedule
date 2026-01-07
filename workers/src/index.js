import { ApplicationServerKeys, generatePushHTTPRequest } from "webpush-webcrypto";

// cron は「毎分」想定のため、未来方向の許容を大きくすると
// 次の分の通知を前の分の実行で拾ってしまい、最大約1分早く送られ得る。
// 遅延（過去方向）は多少許容しつつ、早まり（未来方向）は最小限にする。
const DEFAULT_LATE_WINDOW_MS = 70_000; // 遅れて実行されたcronの揺れを吸収
const DEFAULT_EARLY_WINDOW_MS = 5_000; // 早まりは極力許容しない（5秒以内）
const DEFAULT_LOOKAHEAD_DAYS = 365;

// クエストリマインドは push_send_log.loop_marker_id をセンチネルで流用し、重複送信を抑止する。
// 既存の loop_marker は通常正のIDなので衝突しない。
const QUEST_REMINDER_LOOP_MARKER_ID = -999;

const json = (obj, init = {}) =>
  new Response(JSON.stringify(obj, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });

const buildCorsHeaders = (request) => {
  const origin = request.headers.get("Origin") || "";
  // Reflect the request origin to avoid exact-match pitfalls (e.g. trailing slash).
  // This endpoint relies on Authorization: Bearer <supabase access token>.
  const allowOrigin = origin || "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
};

const jsonWithCors = (request, env, obj, init = {}) => {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    ...buildCorsHeaders(request),
    ...(init?.headers || {}),
  };

  return new Response(JSON.stringify(obj, null, 2), {
    ...init,
    headers,
  });
};

const bytesToBase64 = (bytes) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const base64ToBytes = (b64) => {
  const raw = atob(String(b64 || ""));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
};

const importAesGcmKey = async (b64) => {
  const keyBytes = base64ToBytes(b64);
  return await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
};

const encryptApiKey = async ({ env, apiKey }) => {
  const secretB64 = mustEnv(env, "AI_CONCIERGE_SETTINGS_KEY_B64");
  const key = await importAesGcmKey(secretB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(String(apiKey || ""));
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
  const ct = new Uint8Array(ctBuf);
  return JSON.stringify({ v: 1, iv: bytesToBase64(iv), ct: bytesToBase64(ct) });
};

const decryptApiKey = async ({ env, ciphertext }) => {
  const secretB64 = mustEnv(env, "AI_CONCIERGE_SETTINGS_KEY_B64");
  const key = await importAesGcmKey(secretB64);

  const parsed = (() => {
    try {
      return JSON.parse(String(ciphertext || ""));
    } catch {
      return null;
    }
  })();
  if (!parsed || parsed.v !== 1) throw new Error("Invalid ciphertext format");

  const iv = base64ToBytes(parsed.iv);
  const ct = base64ToBytes(parsed.ct);
  const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(ptBuf);
};

const readJsonBody = async (request) => {
  try {
    const text = await request.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const getBearerToken = (request) => {
  const header = request.headers.get("Authorization") || request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : "";
};

const fetchSupabaseAuthUser = async ({ env, accessToken }) => {
  const url = new URL("/auth/v1/user", mustEnv(env, "SUPABASE_URL"));
  const key = mustEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Auth failed: ${res.status} ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const mustEnv = (env, key) => {
  const value = env[key];
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
};

const toDateStrUTC = (date) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const addDaysUTC = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const parseYMD = (dateStr) => {
  const match = /^\d{4}-\d{2}-\d{2}$/.exec(String(dateStr || ""));
  if (!match) return null;
  const [y, m, d] = dateStr.split("-").map((v) => Number(v));
  if (!y || !m || !d) return null;
  return { y, m, d };
};

// timezoneOffsetMinutes: +540 (JST) のような「UTCとの差（分）」
// schedule.date はローカル日付（YYYY-MM-DD）として保存されている前提
const makeLocalMidnightUTC = (ymd, timezoneOffsetMinutes) => {
  const utcMs = Date.UTC(ymd.y, ymd.m - 1, ymd.d, 0, 0, 0, 0) - timezoneOffsetMinutes * 60_000;
  return new Date(utcMs);
};

const calculateNotificationTimeUTC = ({ schedule, notification, timezoneOffsetMinutes }) => {
  const ymd = parseYMD(schedule?.date);
  if (!ymd) return null;

  const base = makeLocalMidnightUTC(ymd, timezoneOffsetMinutes);

  const value = Number(notification?.value) || 0;
  const unit = notification?.unit;

  if (schedule?.all_day) {
    // 終日: 当日9:00
    const notificationTime = new Date(base);
    notificationTime.setUTCHours(notificationTime.getUTCHours() + 9);

    if (unit === "days") {
      notificationTime.setUTCDate(notificationTime.getUTCDate() - value);
    }
    return notificationTime;
  }

  if (!schedule?.time) return null;
  const [hh, mm] = String(schedule.time).split(":").map((v) => Number(v));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

  const scheduleDateTime = new Date(base);
  scheduleDateTime.setUTCHours(scheduleDateTime.getUTCHours() + hh);
  scheduleDateTime.setUTCMinutes(scheduleDateTime.getUTCMinutes() + mm);

  const notificationTime = new Date(scheduleDateTime);
  if (unit === "minutes") {
    notificationTime.setUTCMinutes(notificationTime.getUTCMinutes() - value);
  } else if (unit === "hours") {
    notificationTime.setUTCHours(notificationTime.getUTCHours() - value);
  } else if (unit === "days") {
    notificationTime.setUTCDate(notificationTime.getUTCDate() - value);
  }

  return notificationTime;
};

const buildNotificationText = ({ schedule, notification }) => {
  const unitText = { minutes: "分前", hours: "時間前", days: "日前" };
  const timeText = schedule?.all_day ? "終日予定" : String(schedule?.time || "");

  const value = Number(notification?.value) || 0;
  const unit = notification?.unit;

  let notificationTypeText;
  if (value === 0 && unit === "minutes") {
    notificationTypeText = "開始時刻";
  } else {
    notificationTypeText = `${value}${unitText[unit] || ""}`;
  }

  const title = schedule?.name || "名称未設定";
  const memoText = schedule?.memo ? `\nメモ: ${schedule.memo}` : "";

  return {
    title,
    body: `${notificationTypeText}の通知\n${timeText}${memoText}`,
  };
};

const supabaseFetch = async ({ env, path, method = "GET", body, extraHeaders }) => {
  const url = new URL(path, mustEnv(env, "SUPABASE_URL"));
  const key = mustEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...(extraHeaders && typeof extraHeaders === "object" ? extraHeaders : {}),
  };

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase request failed: ${res.status} ${text}`);
  }

  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const getAiKeyCiphertext = async ({ env, userId }) => {
  const select = "openai_api_key_ciphertext";
  const query =
    `/rest/v1/ai_concierge_settings?select=${encodeURIComponent(select)}` +
    `&user_id=eq.${encodeURIComponent(String(userId))}` +
    `&limit=1`;

  const rows = await supabaseFetch({ env, path: query });
  const row = Array.isArray(rows) ? rows[0] : null;
  const ciphertext = typeof row?.openai_api_key_ciphertext === "string" ? row.openai_api_key_ciphertext : "";
  return ciphertext;
};

const upsertAiKeyCiphertext = async ({ env, userId, ciphertext }) => {
  const path = `/rest/v1/ai_concierge_settings?on_conflict=${encodeURIComponent("user_id")}`;
  await supabaseFetch({
    env,
    method: "POST",
    path,
    body: { user_id: String(userId), openai_api_key_ciphertext: String(ciphertext || "") },
    extraHeaders: {
      Prefer: "resolution=merge-duplicates, return=minimal",
    },
  });
};

const deleteAiKeyRow = async ({ env, userId }) => {
  const path = `/rest/v1/ai_concierge_settings?user_id=eq.${encodeURIComponent(String(userId))}`;
  await supabaseFetch({ env, method: "DELETE", path });
};

const callOpenAiChatCompletions = async ({ apiKey, model, messages }) => {
  const safeModel = typeof model === "string" && model.trim() ? model.trim() : "gpt-5.2";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: safeModel,
      messages,
      temperature: 0.2,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `OpenAI API error: ${res.status}`;
    throw new Error(msg);
  }

  const content = data?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
};

const listActiveSubscriptions = async ({ env }) => {
  const select = "user_id,endpoint,p256dh,auth,timezone_offset_minutes";
  return await supabaseFetch({
    env,
    path: `/rest/v1/push_subscriptions?select=${encodeURIComponent(select)}&is_active=eq.true`,
  });
};

const listSchedulesInRange = async ({ env, startDate, endDate }) => {
  const select = "id,user_id,name,date,time,memo,all_day,notifications,is_task,completed";
  const query =
    `/rest/v1/schedules?select=${encodeURIComponent(select)}` +
    `&date=gte.${encodeURIComponent(startDate)}` +
    `&date=lte.${encodeURIComponent(endDate)}`;

  return await supabaseFetch({ env, path: query });
};

const listLoopTimelineStatesForUsers = async ({ env, userIds }) => {
  const ids = Array.isArray(userIds) ? userIds.filter(Boolean) : [];
  if (ids.length === 0) return [];
  const select = "user_id,duration_minutes,start_delay_minutes,start_at,status";
  const inList = ids.map((id) => encodeURIComponent(String(id))).join(",");
  const query =
    `/rest/v1/loop_timeline_state?select=${encodeURIComponent(select)}` +
    `&user_id=in.(${inList})`;
  return await supabaseFetch({ env, path: query });
};

const listLoopTimelineMarkersForUsers = async ({ env, userIds }) => {
  const ids = Array.isArray(userIds) ? userIds.filter(Boolean) : [];
  if (ids.length === 0) return [];
  const select = "id,user_id,text,message,offset_minutes";
  const inList = ids.map((id) => encodeURIComponent(String(id))).join(",");
  const query =
    `/rest/v1/loop_timeline_markers?select=${encodeURIComponent(select)}` +
    `&user_id=in.(${inList})`;
  return await supabaseFetch({ env, path: query });
};

const listQuestReminderSettingsForUsers = async ({ env, userIds }) => {
  const ids = Array.isArray(userIds) ? userIds.filter(Boolean) : [];
  if (ids.length === 0) return [];
  const select = "user_id,enabled,reminder_time_minutes";
  const inList = ids.map((id) => encodeURIComponent(String(id))).join(",");
  const query =
    `/rest/v1/quest_reminder_settings?select=${encodeURIComponent(select)}` +
    `&user_id=in.(${inList})`;
  return await supabaseFetch({ env, path: query });
};

const listDailyQuestTasksForUsersByDateStr = async ({ env, userIds, dateStr }) => {
  const ids = Array.isArray(userIds) ? userIds.filter(Boolean) : [];
  const safeDate = String(dateStr || "").trim();
  if (ids.length === 0 || !safeDate) return [];
  const select = "user_id,date_str,completed";
  const inList = ids.map((id) => encodeURIComponent(String(id))).join(",");
  const query =
    `/rest/v1/daily_quest_tasks?select=${encodeURIComponent(select)}` +
    `&date_str=eq.${encodeURIComponent(safeDate)}` +
    `&user_id=in.(${inList})`;
  return await supabaseFetch({ env, path: query });
};

const toDateStrForOffset = (date, timezoneOffsetMinutes) => {
  const shifted = new Date(date.getTime() + timezoneOffsetMinutes * 60_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const calculateQuestReminderFireAtUTC = ({ now, timezoneOffsetMinutes, reminderTimeMinutes }) => {
  const dateStr = toDateStrForOffset(now, timezoneOffsetMinutes);
  const ymd = parseYMD(dateStr);
  if (!ymd) return null;

  const base = makeLocalMidnightUTC(ymd, timezoneOffsetMinutes);
  const minutes = Number(reminderTimeMinutes);
  if (!Number.isFinite(minutes)) return null;

  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const fireAt = new Date(base);
  fireAt.setUTCHours(fireAt.getUTCHours() + hh);
  fireAt.setUTCMinutes(fireAt.getUTCMinutes() + mm);
  fireAt.setUTCSeconds(0, 0);
  return fireAt;
};

const markSubscriptionInactive = async ({ env, userId, endpoint }) => {
  await supabaseFetch({
    env,
    method: "PATCH",
    path:
      `/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(userId)}` +
      `&endpoint=eq.${encodeURIComponent(endpoint)}`,
    body: { is_active: false, updated_at: new Date().toISOString() },
  });
};

const tryInsertSendLog = async ({ env, row }) => {
  const path =
    `/rest/v1/push_send_log?on_conflict=${encodeURIComponent(
      "user_id,endpoint,schedule_id,notification_index,fire_at"
    )}`;

  // ignore duplicates
  const url = new URL(path, mustEnv(env, "SUPABASE_URL"));
  const key = mustEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=representation",
    },
    body: JSON.stringify(row),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase insert log failed: ${res.status} ${text}`);
  }

  if (!text) return false;
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data.length > 0 : !!data;
  } catch {
    return false;
  }
};

const tryInsertLoopSendLog = async ({ env, row }) => {
  const path =
    `/rest/v1/push_send_log?on_conflict=${encodeURIComponent(
      "user_id,endpoint,loop_marker_id,fire_at"
    )}`;

  // ignore duplicates
  const url = new URL(path, mustEnv(env, "SUPABASE_URL"));
  const key = mustEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=representation",
    },
    body: JSON.stringify(row),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase insert loop log failed: ${res.status} ${text}`);
  }

  if (!text) return false;
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data.length > 0 : !!data;
  } catch {
    return false;
  }
};

const tryInsertQuestSendLog = async ({ env, userId, endpoint, fireAtIso }) => {
  // loop_marker_id + fire_at のuniqueを流用して重複送信を抑止
  return await tryInsertLoopSendLog({
    env,
    row: {
      user_id: userId,
      endpoint,
      loop_marker_id: QUEST_REMINDER_LOOP_MARKER_ID,
      fire_at: fireAtIso,
    },
  });
};

const loadApplicationServerKeys = async (env) => {
  const publicKey = mustEnv(env, "VAPID_PUBLIC_KEY");
  const privateKey = mustEnv(env, "VAPID_PRIVATE_KEY_PKCS8");
  return await ApplicationServerKeys.fromJSON({ publicKey, privateKey });
};

const sendPush = async ({ env, applicationServerKeys, target, payload, ttl = 60, urgency = "normal" }) => {
  const adminContact = env.ADMIN_CONTACT || "mailto:admin@example.com";
  const { headers, body, endpoint } = await generatePushHTTPRequest({
    applicationServerKeys,
    payload,
    target,
    adminContact,
    ttl,
    urgency,
  });

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body,
  });

  return res;
};

const runCron = async (env) => {
  const lookaheadDays = Number(env.LOOKAHEAD_DAYS || "") || DEFAULT_LOOKAHEAD_DAYS;
  // 互換: 以前の DUE_WINDOW_MS は「遅れ側」の許容として扱う。
  const lateWindowMs = Number(env.DUE_LATE_WINDOW_MS || env.DUE_WINDOW_MS || "") || DEFAULT_LATE_WINDOW_MS;
  const earlyWindowMs = Number(env.DUE_EARLY_WINDOW_MS || "") || DEFAULT_EARLY_WINDOW_MS;

  const now = new Date();
  const startDate = toDateStrUTC(addDaysUTC(now, -2));
  const endDate = toDateStrUTC(addDaysUTC(now, lookaheadDays + 2));

  const subscriptions = await listActiveSubscriptions({ env });
  const subsList = Array.isArray(subscriptions) ? subscriptions : [];
  const userIds = Array.from(
    new Set(subsList.map((s) => s?.user_id).filter(Boolean).map((v) => String(v)))
  );

  const [schedules, loopStates, loopMarkers] = await Promise.all([
    listSchedulesInRange({ env, startDate, endDate }),
    listLoopTimelineStatesForUsers({ env, userIds }),
    listLoopTimelineMarkersForUsers({ env, userIds }),
  ]);

  const questReminderSettings = await listQuestReminderSettingsForUsers({ env, userIds });
  const questReminderByUserId = new Map(
    (Array.isArray(questReminderSettings) ? questReminderSettings : [])
      .filter((r) => r?.user_id)
      .map((r) => [String(r.user_id), r])
  );

  const applicationServerKeys = await loadApplicationServerKeys(env);

  const scheduleList = Array.isArray(schedules) ? schedules : [];
  const loopStateList = Array.isArray(loopStates) ? loopStates : [];
  const loopMarkerList = Array.isArray(loopMarkers) ? loopMarkers : [];

  const loopStateByUserId = new Map(loopStateList.map((s) => [String(s?.user_id || ""), s]));
  const loopMarkersByUserId = new Map();
  for (const m of loopMarkerList) {
    const uid = String(m?.user_id || "");
    if (!uid) continue;
    if (!loopMarkersByUserId.has(uid)) loopMarkersByUserId.set(uid, []);
    loopMarkersByUserId.get(uid).push(m);
  }

  // endpoint単位で評価（多端末送信対応）
  for (const sub of subsList) {
    const userId = sub?.user_id;
    const endpoint = sub?.endpoint;
    const p256dh = sub?.p256dh;
    const auth = sub?.auth;
    const tz = Number(sub?.timezone_offset_minutes);
    const timezoneOffsetMinutes = Number.isFinite(tz) ? tz : 0;

    if (!userId || !endpoint || !p256dh || !auth) continue;

    // 予定/タスク通知を最優先したいので、同一cron実行内で一度でも送ったendpointでは
    // ループ通知を抑制する（同時刻にループが重なっても重要通知を邪魔しない）。
    let sentImportantThisTick = false;

    const userSchedules = scheduleList.filter((s) => s?.user_id === userId);
    for (const schedule of userSchedules) {
      const notifs = Array.isArray(schedule?.notifications) ? schedule.notifications : [];
      if (notifs.length === 0) continue;

      for (let i = 0; i < notifs.length; i++) {
        const notification = notifs[i];
        const fireAt = calculateNotificationTimeUTC({ schedule, notification, timezoneOffsetMinutes });
        if (!fireAt) continue;

        const diff = fireAt.getTime() - now.getTime();
        if (diff < -lateWindowMs || diff > earlyWindowMs) continue;

        const fireAtIso = fireAt.toISOString();
        const shouldSend = await tryInsertSendLog({
          env,
          row: {
            user_id: userId,
            endpoint,
            schedule_id: schedule.id,
            notification_index: i,
            fire_at: fireAtIso,
          },
        });

        if (!shouldSend) continue;

        const { title, body } = buildNotificationText({ schedule, notification });
        const baseUrl = String(env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
        const payload = JSON.stringify({
          title,
          body,
          url: `${baseUrl || ""}/#date=${encodeURIComponent(String(schedule.date || ""))}`,
        });

        const res = await sendPush({
          env,
          applicationServerKeys,
          target: {
            endpoint,
            keys: { p256dh, auth },
          },
          payload,
          ttl: 60,
          urgency: "high",
        });

        sentImportantThisTick = true;

        if (res.status === 404 || res.status === 410) {
          await markSubscriptionInactive({ env, userId, endpoint });
        }
      }
    }

    // ループタイムライン通知（マーカー到達）
    const loopState = loopStateByUserId.get(String(userId));
    const status = String(loopState?.status || "").toLowerCase();
    const isRunning = status === "running";
    const isPaused = status === "paused" || status.startsWith("paused:");
    const startAtRaw = loopState?.start_at;
    const startAtMs = startAtRaw ? Date.parse(String(startAtRaw)) : NaN;
    const durationMinutes = Number(loopState?.duration_minutes);

    if (!sentImportantThisTick && isRunning && !isPaused && Number.isFinite(startAtMs) && Number.isFinite(durationMinutes) && durationMinutes > 0) {
      const nowMs = now.getTime();
      if (startAtMs <= nowMs) {
        const durationMs = durationMinutes * 60_000;
        const elapsedMs = Math.max(0, nowMs - startAtMs);
        const currentCycle = Math.floor(elapsedMs / durationMs);

        const markersForUser = loopMarkersByUserId.get(String(userId)) || [];
        for (const marker of markersForUser) {
          const markerId = marker?.id;
          const text = String(marker?.text || "").trim();
          const message = String(marker?.message || "").trim();
          if (!text) continue;
          if (markerId == null) continue;

          const rawOffset = Number(marker?.offset_minutes);
          const offsetMinutes = Number.isFinite(rawOffset)
            ? Math.min(durationMinutes, Math.max(0, Math.floor(rawOffset)))
            : 0;

          const candidateCycles = [currentCycle, currentCycle + 1];
          for (const cycle of candidateCycles) {
            const fireAtMs = startAtMs + (cycle * durationMs) + (offsetMinutes * 60_000);
            const diff = fireAtMs - nowMs;
            if (diff < -lateWindowMs || diff > earlyWindowMs) continue;

            const fireAtIso = new Date(fireAtMs).toISOString();
            const shouldSend = await tryInsertLoopSendLog({
              env,
              row: {
                user_id: userId,
                endpoint,
                loop_marker_id: markerId,
                fire_at: fireAtIso,
              },
            });
            if (!shouldSend) continue;

            const loopBody = offsetMinutes === 0
              ? `ループ開始（${durationMinutes}分周期）`
              : `開始から${offsetMinutes}分（${durationMinutes}分周期）`;

            const baseUrl = String(env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
            const payload = JSON.stringify({
              title: text,
              body: message || loopBody,
              url: `${baseUrl || ""}/`,
            });

            const res = await sendPush({
              env,
              applicationServerKeys,
              target: {
                endpoint,
                keys: { p256dh, auth },
              },
              payload,
              ttl: 60,
              urgency: "low",
            });

            if (res.status === 404 || res.status === 410) {
              await markSubscriptionInactive({ env, userId, endpoint });
            }
          }
        }
      }
    }

    // クエストリマインド（デイリー）
    const questSetting = questReminderByUserId.get(String(userId));
    const questEnabled = !!questSetting?.enabled;
    const reminderTimeMinutes = Number(questSetting?.reminder_time_minutes);
    if (questEnabled && Number.isFinite(reminderTimeMinutes)) {
      // 「毎分cron」前提で、今日の指定時刻だけ送る（遅延はlateWindowで吸収）
      const fireAt = calculateQuestReminderFireAtUTC({
        now,
        timezoneOffsetMinutes,
        reminderTimeMinutes,
      });

      if (fireAt) {
        const diff = fireAt.getTime() - now.getTime();
        if (!(diff < -lateWindowMs || diff > earlyWindowMs)) {
          const fireAtIso = fireAt.toISOString();

          const localDateStr = toDateStrForOffset(now, timezoneOffsetMinutes);
          const tasks = await listDailyQuestTasksForUsersByDateStr({
            env,
            userIds: [userId],
            dateStr: localDateStr,
          });

          const list = Array.isArray(tasks) ? tasks : [];
          const total = list.length;
          const remaining = list.filter((t) => !t?.completed).length;

          // タスクが0件なら通知しない（「未完了」判定ができないため）
          if (total > 0 && remaining > 0) {
            // 重複送信を抑止（送る直前にログを取る）
            const shouldSend = await tryInsertQuestSendLog({
              env,
              userId,
              endpoint,
              fireAtIso,
            });

            if (shouldSend) {
              const baseUrl = String(env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
              const payload = JSON.stringify({
                title: "クエスト忘れてませんか？",
                body: `今日のデイリークエストが${remaining}件残っています（全${total}件）`,
                url: `${baseUrl || ""}/#date=${encodeURIComponent(localDateStr)}`,
              });

              const res = await sendPush({
                env,
                applicationServerKeys,
                target: {
                  endpoint,
                  keys: { p256dh, auth },
                },
                payload,
                ttl: 60,
                urgency: "normal",
              });

              if (res.status === 404 || res.status === 410) {
                await markSubscriptionInactive({ env, userId, endpoint });
              }
            }
          }
        }
      }
    }
  }
};

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...buildCorsHeaders(request),
        },
      });
    }

    // AI endpoints
    if (url.pathname === "/ai/settings/status" && request.method === "GET") {
      try {
        const token = getBearerToken(request);
        if (!token) return jsonWithCors(request, env, { ok: false, error: "Unauthorized" }, { status: 401 });

        const user = await fetchSupabaseAuthUser({ env, accessToken: token });
        const userId = user?.id || user?.user?.id;
        if (!userId) return jsonWithCors(request, env, { ok: false, error: "Unauthorized" }, { status: 401 });

        const ciphertext = await getAiKeyCiphertext({ env, userId });
        return jsonWithCors(request, env, { ok: true, saved: !!(ciphertext && String(ciphertext).trim()) });
      } catch (error) {
        return jsonWithCors(request, env, { ok: false, error: error?.message || String(error) }, { status: 500 });
      }
    }

    if (url.pathname === "/ai/settings/api-key" && request.method === "POST") {
      try {
        const token = getBearerToken(request);
        if (!token) return jsonWithCors(request, env, { ok: false, error: "Unauthorized" }, { status: 401 });

        const user = await fetchSupabaseAuthUser({ env, accessToken: token });
        const userId = user?.id || user?.user?.id;
        if (!userId) return jsonWithCors(request, env, { ok: false, error: "Unauthorized" }, { status: 401 });

        const body = await readJsonBody(request);
        const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
        if (!apiKey) {
          return jsonWithCors(request, env, { ok: false, error: "apiKey is required" }, { status: 400 });
        }

        const ciphertext = await encryptApiKey({ env, apiKey });
        await upsertAiKeyCiphertext({ env, userId, ciphertext });
        return jsonWithCors(request, env, { ok: true, saved: true });
      } catch (error) {
        return jsonWithCors(request, env, { ok: false, error: error?.message || String(error) }, { status: 500 });
      }
    }

    if (url.pathname === "/ai/settings/api-key" && request.method === "DELETE") {
      try {
        const token = getBearerToken(request);
        if (!token) return jsonWithCors(request, env, { ok: false, error: "Unauthorized" }, { status: 401 });

        const user = await fetchSupabaseAuthUser({ env, accessToken: token });
        const userId = user?.id || user?.user?.id;
        if (!userId) return jsonWithCors(request, env, { ok: false, error: "Unauthorized" }, { status: 401 });

        await deleteAiKeyRow({ env, userId });
        return jsonWithCors(request, env, { ok: true, saved: false });
      } catch (error) {
        return jsonWithCors(request, env, { ok: false, error: error?.message || String(error) }, { status: 500 });
      }
    }

    if (url.pathname === "/ai/chat" && request.method === "POST") {
      try {
        const token = getBearerToken(request);
        if (!token) return jsonWithCors(request, env, { ok: false, error: "Unauthorized" }, { status: 401 });

        const user = await fetchSupabaseAuthUser({ env, accessToken: token });
        const userId = user?.id || user?.user?.id;
        if (!userId) return jsonWithCors(request, env, { ok: false, error: "Unauthorized" }, { status: 401 });

        const ciphertext = await getAiKeyCiphertext({ env, userId });
        if (!ciphertext) {
          return jsonWithCors(
            request,
            env,
            { ok: false, error: "AI APIキーが未設定です（設定→AIコンシェルジュで保存してください）" },
            { status: 400 }
          );
        }

        const apiKey = await decryptApiKey({ env, ciphertext });
        const body = await readJsonBody(request);

        const model = typeof body?.model === "string" ? body.model : "gpt-5.2";
        const incoming = Array.isArray(body?.messages) ? body.messages : [];
        const context = body?.context && typeof body.context === "object" ? body.context : {};
        const selectedDate = typeof context?.selectedDate === "string" ? context.selectedDate : "";
        const schemaText = context?.schema ? JSON.stringify(context.schema) : "";
        const targetSchedule = context?.targetSchedule ? JSON.stringify(context.targetSchedule) : "";
        const taskList = context?.taskList ? JSON.stringify(context.taskList) : "";
        const search = context?.search ? JSON.stringify(context.search) : "";
        const bulkHint = context?.bulkHint ? JSON.stringify(context.bulkHint) : "";

        const system = [
          "あなたはカレンダーアプリのAIコンシェルジュです。",
          "できること: 予定/タスクの閲覧・検索・作成・変更の提案。",
          "重要: 破壊的操作（作成/変更/削除）の最終実行はユーザーが行うため、あなたは actions を提案するだけにしてください。",
          "複数件の一括操作（Volt相当）: 複数件の移動/コピー/相対ずらしは kind: bulk を優先して1件で提案する（大量のcreate/updateを並べない）。曖昧なら対象/基準を質問する。bulk payload: {operation:aggregate|relative, action:move|copy, ids:string[], targetDate:YYYY-MM-DD, baseId?:string}",
          "taskListの使い方: upcomingDeadlineTasks(納期/期限)を最優先、未完了/やり残しはupcomingTasks、直近/最近はrecentTasksも候補。bulkのidsはtaskList内のidから選ぶ。",
          "baseIdの決め方(relative): ユーザーが基準を明示→それをbaseId。明示がなければ候補内で最も早い日付を基準にしてよいが、summaryに基準を明記。曖昧なら質問してactionsは空にする。",
          "出力は必ずJSON: {text: string, actions: Array} のみ。",
        ].join("\n");

        const messages = [
          { role: "system", content: system },
          ...(selectedDate ? [{ role: "system", content: `selectedDate: ${selectedDate}` }] : []),
          ...(schemaText ? [{ role: "system", content: `schema: ${schemaText}` }] : []),
          ...(taskList ? [{ role: "system", content: `taskList: ${taskList}` }] : []),
          ...(search ? [{ role: "system", content: `search: ${search}` }] : []),
          ...(bulkHint ? [{ role: "system", content: `bulkHint: ${bulkHint}` }] : []),
          ...(targetSchedule ? [{ role: "system", content: `targetSchedule: ${targetSchedule}` }] : []),
          ...incoming
            .filter((m) => m && typeof m === "object")
            .map((m) => ({ role: m.role, content: String(m.content ?? "") })),
        ];

        const content = await callOpenAiChatCompletions({ apiKey, model, messages });
        if (!content) {
          return jsonWithCors(request, env, { ok: true, text: "（AIの応答が空でした）", actions: [] });
        }

        const parsed = (() => {
          try {
            return JSON.parse(content);
          } catch {
            return null;
          }
        })();

        if (parsed && typeof parsed === "object") {
          return jsonWithCors(request, env, {
            ok: true,
            text: typeof parsed.text === "string" ? parsed.text : content,
            actions: Array.isArray(parsed.actions) ? parsed.actions : [],
          });
        }

        return jsonWithCors(request, env, { ok: true, text: content, actions: [] });
      } catch (error) {
        return jsonWithCors(request, env, { ok: false, error: error?.message || String(error) }, { status: 500 });
      }
    }
    if (url.pathname === "/__health") {
      return jsonWithCors(request, env, { ok: true });
    }

    if (url.pathname === "/__cron" && request.method === "POST") {
      try {
        await runCron(env);
        return json({ ok: true });
      } catch (error) {
        return json({ ok: false, error: error?.message || String(error) }, { status: 500 });
      }
    }

    return jsonWithCors(request, env, { ok: true, message: "the-schedule push worker" });
  },
};
