import db from "../config/db.js";
import AppError from "../utils/appError.js";

// ─── In-Memory Permission Cache ───────────────────────────────────────────────
// Keyed by group_id → Set of permission_keys
// TTL: 5 minutes — balances freshness vs DB load.
// On a multi-server setup, replace this module with a Redis-backed equivalent
// that exposes the same API (getGroupPermissions / invalidateGroup).

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const cache = new Map(); // group_id → { permissions: Set<string>, expiresAt: number }

/**
 * Returns the Set<string> of permission keys for a group.
 * Fetches from DB on first call or after TTL expiry.
 *
 * @param {number} groupId
 * @returns {Promise<Set<string>>}
 */
const getGroupPermissions = async (groupId) => {
  const now = Date.now();
  const cached = cache.get(groupId);

  if (cached && cached.expiresAt > now) {
    return cached.permissions;
  }

  // Cache miss or expired — fetch from DB
  const [rows] = await db.query(
    `SELECT p.permission_key
     FROM group_permissions gp
     JOIN permissions p ON p.permission_id = gp.permission_id
     WHERE gp.group_id = ?`,
    [groupId],
  );

  const permissions = new Set(rows.map((r) => r.permission_key));
  cache.set(groupId, { permissions, expiresAt: now + CACHE_TTL_MS });

  return permissions;
};

/**
 * Removes a group's cached permissions, forcing the next request to re-fetch.
 * Call this whenever group permissions are modified.
 *
 * @param {number} groupId
 */
export const invalidateGroup = (groupId) => {
  cache.delete(groupId);
};

/**
 * Clears the entire permission cache.
 * Useful after bulk permission changes.
 */
export const invalidateAll = () => {
  cache.clear();
};

// ─── Middleware Factory ───────────────────────────────────────────────────────

/**
 * Returns an Express middleware that checks whether the authenticated user's
 * group has all of the specified permissions.
 *
 * Usage:
 *   router.patch('/transactions/:id/approve',
 *     verifyJWT,
 *     checkPermission('transaction:approve'),
 *     controller
 *   );
 *
 *   // Require multiple permissions (AND logic):
 *   checkPermission('transaction:approve', 'report:export')
 *
 * @param {...string} requiredKeys  One or more permission_key strings
 * @returns {import('express').RequestHandler}
 */
const checkPermission = (...requiredKeys) => {
  if (requiredKeys.length === 0) {
    throw new Error("checkPermission() requires at least one permission key.");
  }

  return async (req, res, next) => {
    try {
      // verifyJWT must run first — it attaches req.user
      const { group_id } = req.user;

      if (!group_id) {
        return next(
          new AppError("User has no group assigned. Access denied.", 403),
        );
      }

      const permissions = await getGroupPermissions(group_id);

      const denied = requiredKeys.filter((key) => !permissions.has(key));

      if (denied.length > 0) {
        return next(
          new AppError(`Insufficient permissions: ${denied.join(", ")}`, 403),
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

export default checkPermission;
