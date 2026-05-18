// controllers/notifications.controller.js
// ─────────────────────────────────────────────────────────────────────────────
// Follows the exact same patterns as approval.controller.js and
// transactions.controller.js:
//   - ES module syntax (import/export)
//   - db.query() with mysql2 promise pool
//   - AppError for all error cases
//   - req.user injected by verifyJWT middleware (user_id, user_name)
//   - paginate() utility for the list endpoint
//   - conn.beginTransaction() only where atomicity is needed
//   - Consistent JSON shape: { success, message, data }
// ─────────────────────────────────────────────────────────────────────────────

import db from "../config/db.js";
import AppError from "../utils/appError.js";
import { paginate } from "../utils/paginate.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const UNREAD = 0;
const READ = 1;

// ─── Helper: verify ownership and existence ───────────────────────────────────
// Returns the notification row or throws AppError.
// Always scopes to the requesting user so users can never touch each other's rows.
const getOwnedNotification = async (notificationId, userId) => {
  const [[row]] = await db.query(
    `SELECT notification_id, notification_user_id, notification_read
     FROM notifications
     WHERE notification_id = ? AND notification_user_id = ?
     LIMIT 1`,
    [notificationId, userId],
  );

  if (!row) {
    throw new AppError("Notification not found.", 404);
  }

  return row;
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /notifications
// Returns a paginated list of notifications for the authenticated user.
// Supports: page, per_page, sort_by, sort_dir, search (title/message),
//           and an optional ?unread_only=1 filter.
// ─────────────────────────────────────────────────────────────────────────────
export const getNotifications = async (req, res, next) => {
  try {
    const userId = req.user.user_id;

    const result = await paginate({
      query: req.query,
      table: "notifications",
      db,
      baseCondition: `notification_user_id = ${userId}`,
      searchColumns: ["notification_title", "notification_message"],
      allowedSorts: [
        "notification_id",
        "notification_kind",
        "notification_read",
        "created_at",
      ],
      defaultSort: "notification_id",
      defaultSortDir: "desc", // newest first
      filters: (query, conditions, values) => {
        // ?unread_only=1  → only return unread rows
        if (query.unread_only === "1") {
          conditions.push("notification_read = ?");
          values.push(UNREAD);
        }

        // ?kind=error  → filter by notification kind
        if (query.kind) {
          conditions.push("notification_kind = ?");
          values.push(query.kind);
        }
      },
    });

    // Attach the unread count to every response so the badge is always accurate
    const [[{ unreadCount }]] = await db.query(
      `SELECT COUNT(*) AS unreadCount
       FROM notifications
       WHERE notification_user_id = ? AND notification_read = ?`,
      [userId, UNREAD],
    );

    // Reshape rows to match the Zod schema expected by the frontend:
    //   { id, kind, title, message, href, createdAt, read }
    const data = result.data.map((row) => ({
      id: String(row.notification_id),
      kind: row.notification_kind,
      title: row.notification_title,
      message: row.notification_message,
      href: row.notification_href ?? undefined,
      createdAt: row.created_at,
      read: row.notification_read === READ,
    }));

    return res.status(200).json({
      success: true,
      data,
      unreadCount: Number(unreadCount),
      total: result.totalRecords,
      // Pass through pagination meta for future use
      meta: {
        current_page: result.page,
        per_page: result.limit,
        last_page: result.totalPages,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /notifications/:notificationId/read
// Marks a single notification as read. Scoped to the requesting user.
// ─────────────────────────────────────────────────────────────────────────────
export const markOneRead = async (req, res, next) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.user_id;

    const row = await getOwnedNotification(notificationId, userId);

    // Already read — return the row as-is (idempotent)
    if (row.notification_read === READ) {
      return res.status(200).json({
        success: true,
        message: "Notification already marked as read.",
        data: {
          id: String(row.notification_id),
          read: true,
        },
      });
    }

    await db.query(
      `UPDATE notifications
       SET notification_read = ?, updated_at = CURRENT_TIMESTAMP
       WHERE notification_id = ?`,
      [READ, notificationId],
    );

    return res.status(200).json({
      success: true,
      message: "Notification marked as read.",
      data: {
        id: String(notificationId),
        read: true,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /notifications/read-all
// Marks ALL unread notifications as read for the authenticated user.
// ─────────────────────────────────────────────────────────────────────────────
export const markAllRead = async (req, res, next) => {
  try {
    const userId = req.user.user_id;

    const [result] = await db.query(
      `UPDATE notifications
       SET notification_read = ?, updated_at = CURRENT_TIMESTAMP
       WHERE notification_user_id = ? AND notification_read = ?`,
      [READ, userId, UNREAD],
    );

    return res.status(200).json({
      success: true,
      message: `${result.affectedRows} notification(s) marked as read.`,
      updated: result.affectedRows,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /notifications/:notificationId
// Permanently deletes a single notification. Scoped to the requesting user.
// ─────────────────────────────────────────────────────────────────────────────
export const deleteNotification = async (req, res, next) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.user_id;

    // Verify ownership first — throws 404 if not found or not owned
    await getOwnedNotification(notificationId, userId);

    await db.query(`DELETE FROM notifications WHERE notification_id = ?`, [
      notificationId,
    ]);

    return res.status(200).json({
      success: true,
      message: "Notification deleted.",
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPER — createNotification()
// NOT an HTTP handler. Call this from other controllers whenever you need
// to fire a notification. Import it directly:
//
//   import { createNotification } from "../controllers/notifications.controller.js";
//
// Example — inside approval.controller.js after approveTransaction():
//   await createNotification({
//     userId:  originalCreatorId,
//     kind:    "success",
//     title:   "Transaction approved",
//     message: `Transaction #${idn} has been approved.`,
//     href:    `/transaction-entries/edit/${transactionId}`,
//   });
// ─────────────────────────────────────────────────────────────────────────────
export const createNotification = async ({
  userId,
  kind = "info",
  title,
  message,
  href = null,
  conn = null, // pass an existing connection to join a transaction
}) => {
  const executor = conn ?? db;

  await executor.query(
    `INSERT INTO notifications
       (notification_user_id, notification_kind, notification_title,
        notification_message, notification_href)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, kind, title, message, href],
  );
};
