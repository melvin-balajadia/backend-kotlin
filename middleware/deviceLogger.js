import { UAParser } from "ua-parser-js";
import logger from "../config/logger.js";

export function deviceLoggerMiddleware(req, res, next) {
  const parser = new UAParser(req.headers["user-agent"]);
  const result = parser.getResult();

  // ─── IP Resolution ────────────────────────────────────────────────────────
  // x-forwarded-for handles proxies/load balancers (takes the first/original IP)
  const rawForwardedFor = req.headers["x-forwarded-for"];
  const ip = rawForwardedFor
    ? rawForwardedFor.split(",")[0].trim()
    : req.ip || req.socket?.remoteAddress || "unknown";

  // ─── Device Info ──────────────────────────────────────────────────────────
  req.deviceInfo = {
    // ── Request identity ──
    requestId: crypto.randomUUID(), // unique ID to trace this request across logs
    timestamp: new Date().toISOString(),

    // ── Network ──
    ip,
    protocol: req.protocol, // http | https
    hostname: req.hostname,

    // ── Request ──
    method: req.method,
    url: req.originalUrl,
    referrer: req.headers["referer"] || req.headers["referrer"] || null,

    // ── Browser ──
    browser: {
      name: result.browser.name || "unknown",
      version: result.browser.version || "unknown",
      major: result.browser.major || "unknown",
    },

    // ── OS ──
    os: {
      name: result.os.name || "unknown",
      version: result.os.version || "unknown",
    },

    // ── Device ──
    device: {
      type: result.device.type || "desktop",
      vendor: result.device.vendor || "unknown",
      model: result.device.model || "unknown",
    },

    // ── Engine ──
    engine: {
      name: result.engine.name || "unknown",
      version: result.engine.version || "unknown",
    },

    // ── Raw UA string — useful when ua-parser returns unknowns ──
    userAgent: req.headers["user-agent"] || "unknown",
  };

  // ─── Audit Log ────────────────────────────────────────────────────────────
  logger.info("Auth attempt", {
    audit: true, // flag so you can filter audit logs separately
    ...req.deviceInfo,
  });

  next();
}
