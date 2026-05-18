// controllers/softDelete.controller.js
//
// Soft delete and restore logic — all inline, no separate service layer.
// Matches your existing controller style (transactions.controller.js,
// handlingUnit.controller.js, group.controller.js).

import db from "../config/db.js";
import AppError from "../utils/appError.js";
import logger from "../config/logger.js";

// ─── Status constants (mirrors approval.controller.js) ────────────────────────
const TX_STATUS = {
  DRAFT: 0,
  SUBMITTED: 1,
  CHECKED: 2,
  NOTED: 3,
  COMPLETED: 4,
  REJECTED: 5,
  RETURNED: 6,
  ARCHIVED: 7,
};

// Transactions in these statuses are locked — cannot be deleted.
// Draft (0) and Returned (6) are the only deletable states.
const LOCKED_STATUSES = new Set([
  TX_STATUS.SUBMITTED,
  TX_STATUS.CHECKED,
  TX_STATUS.NOTED,
  TX_STATUS.COMPLETED,
]);

const LOCKED_STATUS_LABELS = {
  [TX_STATUS.SUBMITTED]: "Submitted (pending first approval)",
  [TX_STATUS.CHECKED]: "Checked by (pending final approval)",
  [TX_STATUS.NOTED]: "Noted by (approved)",
  [TX_STATUS.COMPLETED]: "Completed",
};

// ─── Shared audit log writer ──────────────────────────────────────────────────
// Reuses transaction_approval_logs so your frontend timeline renders it automatically.
const writeAuditLog = async (
  conn,
  {
    transactionId,
    action,
    fromStatus,
    toStatus,
    actorId,
    actorName,
    stepLabel,
    comment,
  },
) => {
  await conn.query(
    `INSERT INTO transaction_approval_logs
       (log_transaction_id, log_action, log_from_status, log_to_status,
        log_actor_id, log_actor_name, log_step_label, log_comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      transactionId,
      action,
      fromStatus,
      toStatus,
      actorId,
      actorName,
      stepLabel,
      comment ?? null,
    ],
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// DELETE — TRANSACTION ENTRY  (cascades → HU → Items)
// DELETE /transaction-entry/:id
// ══════════════════════════════════════════════════════════════════════════════
export const deleteTransaction = async (req, res, next) => {
  const { id } = req.params;
  const { reason } = req.body;
  const actorId = req.user.user_id;
  const actorName = req.user.user_name;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ── 1. Fetch and validate ─────────────────────────────────────────────────
    const [[tx]] = await conn.query(
      `SELECT transaction_id, transaction_status, transaction_is_deleted
       FROM transaction_entry
       WHERE transaction_id = ?
       LIMIT 1`,
      [id],
    );

    if (!tx) {
      await conn.rollback();
      return next(new AppError("Transaction not found.", 404));
    }

    if (tx.transaction_is_deleted) {
      await conn.rollback();
      return next(new AppError("Transaction is already deleted.", 409));
    }

    if (LOCKED_STATUSES.has(tx.transaction_status)) {
      await conn.rollback();
      const label = LOCKED_STATUS_LABELS[tx.transaction_status];
      return next(
        new AppError(
          `Transaction cannot be deleted — it is currently "${label}". ` +
            `Only Draft or Returned transactions may be deleted.`,
          409,
        ),
      );
    }

    const now = new Date();

    // ── 2. Collect active HU ids under this transaction ───────────────────────
    const [hus] = await conn.query(
      `SELECT hu_id FROM hu_entry
       WHERE hu_transaction_id = ? AND hu_is_deleted = 0`,
      [id],
    );
    const huIds = hus.map((h) => h.hu_id);

    // ── 3. Soft-delete all items under those HUs ──────────────────────────────
    let itemsDeleted = 0;
    if (huIds.length > 0) {
      const placeholders = huIds.map(() => "?").join(", ");
      const [itemResult] = await conn.query(
        `UPDATE items_entry
         SET items_is_deleted    = 1,
             items_deleted_at    = ?,
             items_deleted_by    = ?,
             items_delete_reason = ?,
             updated_at          = ?
         WHERE items_hu_id IN (${placeholders})
           AND items_is_deleted = 0`,
        [now, actorId, reason ?? null, now, ...huIds],
      );
      itemsDeleted = itemResult.affectedRows;
    }

    // ── 4. Soft-delete all HUs under this transaction ─────────────────────────
    const [huResult] = await conn.query(
      `UPDATE hu_entry
       SET hu_is_deleted    = 1,
           hu_deleted_at    = ?,
           hu_deleted_by    = ?,
           hu_delete_reason = ?,
           updated_at       = ?
       WHERE hu_transaction_id = ?
         AND hu_is_deleted = 0`,
      [now, actorId, reason ?? null, now, id],
    );

    // ── 5. Soft-delete the transaction itself ─────────────────────────────────
    await conn.query(
      `UPDATE transaction_entry
       SET transaction_is_deleted    = 1,
           transaction_deleted_at    = ?,
           transaction_deleted_by    = ?,
           transaction_delete_reason = ?,
           updated_at                = ?
       WHERE transaction_id = ?`,
      [now, actorId, reason ?? null, now, id],
    );

    // ── 6. Write audit log ────────────────────────────────────────────────────
    await writeAuditLog(conn, {
      transactionId: id,
      action: "delete",
      fromStatus: tx.transaction_status,
      toStatus: tx.transaction_status,
      actorId,
      actorName,
      stepLabel: "Soft Deleted",
      comment: reason
        ? `Deleted by ${actorName}. Reason: ${reason}`
        : `Deleted by ${actorName}`,
    });

    await conn.commit();

    logger.info({
      event: "soft_delete_transaction",
      transactionId: id,
      actorId,
      husDeleted: huResult.affectedRows,
      itemsDeleted,
    });

    return res.status(200).json({
      errorStatus: false,
      message: "Transaction deleted successfully.",
      data: {
        transactionId: Number(id),
        husDeleted: huResult.affectedRows,
        itemsDeleted,
      },
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// DELETE — HANDLING UNIT  (cascades → Items only, does NOT touch transaction)
// DELETE /hu-entry/:huId
// ══════════════════════════════════════════════════════════════════════════════
export const deleteHU = async (req, res, next) => {
  const { huId } = req.params;
  const { reason } = req.body;
  const actorId = req.user.user_id;
  const actorName = req.user.user_name;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ── 1. Fetch HU ───────────────────────────────────────────────────────────
    const [[hu]] = await conn.query(
      `SELECT hu_id, hu_transaction_id, hu_is_deleted
       FROM hu_entry
       WHERE hu_id = ?
       LIMIT 1`,
      [huId],
    );

    if (!hu) {
      await conn.rollback();
      return next(new AppError("Handling unit not found.", 404));
    }

    if (hu.hu_is_deleted) {
      await conn.rollback();
      return next(new AppError("Handling unit is already deleted.", 409));
    }

    // ── 2. Validate parent transaction is editable ────────────────────────────
    const [[tx]] = await conn.query(
      `SELECT transaction_id, transaction_status, transaction_is_deleted
       FROM transaction_entry
       WHERE transaction_id = ?
       LIMIT 1`,
      [hu.hu_transaction_id],
    );

    if (!tx || tx.transaction_is_deleted) {
      await conn.rollback();
      return next(
        new AppError(
          "Cannot delete this HU — its parent transaction no longer exists or is already deleted.",
          409,
        ),
      );
    }

    if (LOCKED_STATUSES.has(tx.transaction_status)) {
      await conn.rollback();
      const label = LOCKED_STATUS_LABELS[tx.transaction_status];
      return next(
        new AppError(
          `Cannot delete this HU — the parent transaction is currently "${label}".`,
          409,
        ),
      );
    }

    const now = new Date();

    // ── 3. Soft-delete items under this HU ───────────────────────────────────
    const [itemResult] = await conn.query(
      `UPDATE items_entry
       SET items_is_deleted    = 1,
           items_deleted_at    = ?,
           items_deleted_by    = ?,
           items_delete_reason = ?,
           updated_at          = ?
       WHERE items_hu_id    = ?
         AND items_is_deleted = 0`,
      [now, actorId, reason ?? null, now, huId],
    );

    // ── 4. Soft-delete the HU itself ──────────────────────────────────────────
    await conn.query(
      `UPDATE hu_entry
       SET hu_is_deleted    = 1,
           hu_deleted_at    = ?,
           hu_deleted_by    = ?,
           hu_delete_reason = ?,
           updated_at       = ?
       WHERE hu_id = ?`,
      [now, actorId, reason ?? null, now, huId],
    );

    await conn.commit();

    logger.info({
      event: "soft_delete_hu",
      huId,
      transactionId: hu.hu_transaction_id,
      actorId,
      itemsDeleted: itemResult.affectedRows,
    });

    return res.status(200).json({
      errorStatus: false,
      message: "Handling unit deleted successfully.",
      data: {
        huId: Number(huId),
        transactionId: hu.hu_transaction_id,
        itemsDeleted: itemResult.affectedRows,
      },
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// DELETE — SINGLE ITEM  (no cascade)
// DELETE /items-entry/:itemId
// ══════════════════════════════════════════════════════════════════════════════
export const deleteItem = async (req, res, next) => {
  const { itemId } = req.params;
  const { reason } = req.body;
  const actorId = req.user.user_id;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ── 1. Fetch item ─────────────────────────────────────────────────────────
    const [[item]] = await conn.query(
      `SELECT items_id, items_hu_id, items_is_deleted
       FROM items_entry
       WHERE items_id = ?
       LIMIT 1`,
      [itemId],
    );

    if (!item) {
      await conn.rollback();
      return next(new AppError("Item not found.", 404));
    }

    if (item.items_is_deleted) {
      await conn.rollback();
      return next(new AppError("Item is already deleted.", 409));
    }

    // ── 2. Validate parent HU and transaction are editable ────────────────────
    const [[hu]] = await conn.query(
      `SELECT hu.hu_id,
              hu.hu_is_deleted,
              tx.transaction_status,
              tx.transaction_is_deleted
       FROM hu_entry hu
       JOIN transaction_entry tx ON tx.transaction_id = hu.hu_transaction_id
       WHERE hu.hu_id = ?
       LIMIT 1`,
      [item.items_hu_id],
    );

    if (!hu || hu.hu_is_deleted) {
      await conn.rollback();
      return next(
        new AppError(
          "Cannot delete this item — its parent HU is deleted. Restore the HU first.",
          409,
        ),
      );
    }

    if (hu.transaction_is_deleted) {
      await conn.rollback();
      return next(
        new AppError(
          "Cannot delete this item — its parent transaction is deleted.",
          409,
        ),
      );
    }

    if (LOCKED_STATUSES.has(hu.transaction_status)) {
      await conn.rollback();
      const label = LOCKED_STATUS_LABELS[hu.transaction_status];
      return next(
        new AppError(
          `Cannot delete this item — the parent transaction is currently "${label}".`,
          409,
        ),
      );
    }

    // ── 3. Soft-delete the item ───────────────────────────────────────────────
    await conn.query(
      `UPDATE items_entry
       SET items_is_deleted    = 1,
           items_deleted_at    = NOW(),
           items_deleted_by    = ?,
           items_delete_reason = ?,
           updated_at          = NOW()
       WHERE items_id = ?`,
      [actorId, reason ?? null, itemId],
    );

    await conn.commit();

    logger.info({ event: "soft_delete_item", itemId, actorId });

    return res.status(200).json({
      errorStatus: false,
      message: "Item deleted successfully.",
      data: { itemId: Number(itemId) },
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// RESTORE — TRANSACTION ENTRY  (cascades → HU → Items)
// PATCH /transaction-entry/:id/restore
// ══════════════════════════════════════════════════════════════════════════════
export const restoreTransaction = async (req, res, next) => {
  const { id } = req.params;
  const { reason } = req.body;
  const actorId = req.user.user_id;
  const actorName = req.user.user_name;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ── 1. Fetch and validate ─────────────────────────────────────────────────
    const [[tx]] = await conn.query(
      `SELECT transaction_id, transaction_status,
              transaction_is_deleted, transaction_deleted_at
       FROM transaction_entry
       WHERE transaction_id = ?
       LIMIT 1`,
      [id],
    );

    if (!tx) {
      await conn.rollback();
      return next(new AppError("Transaction not found.", 404));
    }

    if (!tx.transaction_is_deleted) {
      await conn.rollback();
      return next(
        new AppError("Transaction is not deleted — nothing to restore.", 409),
      );
    }

    const now = new Date();
    const deletedAt = tx.transaction_deleted_at; // used to avoid restoring independently-deleted children

    // ── 2. Restore the transaction ────────────────────────────────────────────
    await conn.query(
      `UPDATE transaction_entry
       SET transaction_is_deleted    = 0,
           transaction_deleted_at    = NULL,
           transaction_deleted_by    = NULL,
           transaction_delete_reason = NULL,
           updated_at                = ?
       WHERE transaction_id = ?`,
      [now, id],
    );

    // ── 3. Restore HUs deleted at or after the transaction deletion ───────────
    // This guard prevents restoring HUs the user deliberately deleted
    // BEFORE the transaction-level cascade happened.
    let husRestored = 0;
    let itemsRestored = 0;

    if (deletedAt) {
      const [huResult] = await conn.query(
        `UPDATE hu_entry
         SET hu_is_deleted    = 0,
             hu_deleted_at    = NULL,
             hu_deleted_by    = NULL,
             hu_delete_reason = NULL,
             updated_at       = ?
         WHERE hu_transaction_id = ?
           AND hu_is_deleted  = 1
           AND hu_deleted_at >= ?`,
        [now, id, deletedAt],
      );
      husRestored = huResult.affectedRows;

      // ── 4. Restore items under the now-restored HUs ───────────────────────
      const [restoredHus] = await conn.query(
        `SELECT hu_id FROM hu_entry
         WHERE hu_transaction_id = ? AND hu_is_deleted = 0`,
        [id],
      );
      const huIds = restoredHus.map((h) => h.hu_id);

      if (huIds.length > 0) {
        const placeholders = huIds.map(() => "?").join(", ");
        const [itemResult] = await conn.query(
          `UPDATE items_entry
           SET items_is_deleted    = 0,
               items_deleted_at    = NULL,
               items_deleted_by    = NULL,
               items_delete_reason = NULL,
               updated_at          = ?
           WHERE items_hu_id IN (${placeholders})
             AND items_is_deleted  = 1
             AND items_deleted_at >= ?`,
          [now, ...huIds, deletedAt],
        );
        itemsRestored = itemResult.affectedRows;
      }
    } else {
      // ── Fallback: legacy rows without deleted_at — restore full cascade ────
      const [huResult] = await conn.query(
        `UPDATE hu_entry
         SET hu_is_deleted = 0, hu_deleted_at = NULL,
             hu_deleted_by = NULL, hu_delete_reason = NULL, updated_at = ?
         WHERE hu_transaction_id = ? AND hu_is_deleted = 1`,
        [now, id],
      );
      husRestored = huResult.affectedRows;

      const [restoredHus] = await conn.query(
        `SELECT hu_id FROM hu_entry WHERE hu_transaction_id = ?`,
        [id],
      );
      const huIds = restoredHus.map((h) => h.hu_id);

      if (huIds.length > 0) {
        const placeholders = huIds.map(() => "?").join(", ");
        const [itemResult] = await conn.query(
          `UPDATE items_entry
           SET items_is_deleted = 0, items_deleted_at = NULL,
               items_deleted_by = NULL, items_delete_reason = NULL, updated_at = ?
           WHERE items_hu_id IN (${placeholders}) AND items_is_deleted = 1`,
          [now, ...huIds],
        );
        itemsRestored = itemResult.affectedRows;
      }
    }

    // ── 5. Write audit log ────────────────────────────────────────────────────
    await writeAuditLog(conn, {
      transactionId: id,
      action: "restore",
      fromStatus: tx.transaction_status,
      toStatus: tx.transaction_status,
      actorId,
      actorName,
      stepLabel: "Restored",
      comment: reason
        ? `Restored by ${actorName}. Reason: ${reason}`
        : `Restored by ${actorName}`,
    });

    await conn.commit();

    logger.info({
      event: "restore_transaction",
      transactionId: id,
      actorId,
      husRestored,
      itemsRestored,
    });

    return res.status(200).json({
      errorStatus: false,
      message: "Transaction restored successfully.",
      data: {
        transactionId: Number(id),
        husRestored,
        itemsRestored,
      },
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// RESTORE — HANDLING UNIT  (cascades → Items only)
// PATCH /hu-entry/:huId/restore
// ══════════════════════════════════════════════════════════════════════════════
export const restoreHU = async (req, res, next) => {
  const { huId } = req.params;
  const { reason } = req.body;
  const actorId = req.user.user_id;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ── 1. Fetch HU ───────────────────────────────────────────────────────────
    const [[hu]] = await conn.query(
      `SELECT hu_id, hu_transaction_id, hu_is_deleted, hu_deleted_at
       FROM hu_entry
       WHERE hu_id = ?
       LIMIT 1`,
      [huId],
    );

    if (!hu) {
      await conn.rollback();
      return next(new AppError("Handling unit not found.", 404));
    }

    if (!hu.hu_is_deleted) {
      await conn.rollback();
      return next(
        new AppError("Handling unit is not deleted — nothing to restore.", 409),
      );
    }

    // ── 2. Parent transaction must be active to receive the restored HU ───────
    const [[tx]] = await conn.query(
      `SELECT transaction_id, transaction_is_deleted
       FROM transaction_entry
       WHERE transaction_id = ?
       LIMIT 1`,
      [hu.hu_transaction_id],
    );

    if (!tx || tx.transaction_is_deleted) {
      await conn.rollback();
      return next(
        new AppError(
          "Cannot restore this HU — its parent transaction is deleted. Restore the transaction first.",
          409,
        ),
      );
    }

    const now = new Date();
    const deletedAt = hu.hu_deleted_at;

    // ── 3. Restore the HU ─────────────────────────────────────────────────────
    await conn.query(
      `UPDATE hu_entry
       SET hu_is_deleted    = 0,
           hu_deleted_at    = NULL,
           hu_deleted_by    = NULL,
           hu_delete_reason = NULL,
           updated_at       = ?
       WHERE hu_id = ?`,
      [now, huId],
    );

    // ── 4. Restore items that were deleted at or after the HU's deletion ──────
    let itemsRestored = 0;
    if (deletedAt) {
      const [itemResult] = await conn.query(
        `UPDATE items_entry
         SET items_is_deleted    = 0,
             items_deleted_at    = NULL,
             items_deleted_by    = NULL,
             items_delete_reason = NULL,
             updated_at          = ?
         WHERE items_hu_id       = ?
           AND items_is_deleted  = 1
           AND items_deleted_at >= ?`,
        [now, huId, deletedAt],
      );
      itemsRestored = itemResult.affectedRows;
    } else {
      const [itemResult] = await conn.query(
        `UPDATE items_entry
         SET items_is_deleted = 0, items_deleted_at = NULL,
             items_deleted_by = NULL, items_delete_reason = NULL, updated_at = ?
         WHERE items_hu_id = ? AND items_is_deleted = 1`,
        [now, huId],
      );
      itemsRestored = itemResult.affectedRows;
    }

    await conn.commit();

    logger.info({ event: "restore_hu", huId, actorId, itemsRestored });

    return res.status(200).json({
      errorStatus: false,
      message: "Handling unit restored successfully.",
      data: {
        huId: Number(huId),
        itemsRestored,
      },
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// RESTORE — SINGLE ITEM
// PATCH /items-entry/:itemId/restore
// ══════════════════════════════════════════════════════════════════════════════
export const restoreItem = async (req, res, next) => {
  const { itemId } = req.params;
  const actorId = req.user.user_id;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ── 1. Fetch item ─────────────────────────────────────────────────────────
    const [[item]] = await conn.query(
      `SELECT items_id, items_hu_id, items_is_deleted
       FROM items_entry
       WHERE items_id = ?
       LIMIT 1`,
      [itemId],
    );

    if (!item) {
      await conn.rollback();
      return next(new AppError("Item not found.", 404));
    }

    if (!item.items_is_deleted) {
      await conn.rollback();
      return next(
        new AppError("Item is not deleted — nothing to restore.", 409),
      );
    }

    // ── 2. Parent HU and transaction must be active ───────────────────────────
    const [[hu]] = await conn.query(
      `SELECT hu.hu_id,
              hu.hu_is_deleted,
              tx.transaction_is_deleted
       FROM hu_entry hu
       JOIN transaction_entry tx ON tx.transaction_id = hu.hu_transaction_id
       WHERE hu.hu_id = ?
       LIMIT 1`,
      [item.items_hu_id],
    );

    if (!hu || hu.hu_is_deleted) {
      await conn.rollback();
      return next(
        new AppError(
          "Cannot restore this item — its parent HU is deleted. Restore the HU first.",
          409,
        ),
      );
    }

    if (hu.transaction_is_deleted) {
      await conn.rollback();
      return next(
        new AppError(
          "Cannot restore this item — its parent transaction is deleted. Restore the transaction first.",
          409,
        ),
      );
    }

    // ── 3. Restore the item ───────────────────────────────────────────────────
    await conn.query(
      `UPDATE items_entry
       SET items_is_deleted    = 0,
           items_deleted_at    = NULL,
           items_deleted_by    = NULL,
           items_delete_reason = NULL,
           updated_at          = NOW()
       WHERE items_id = ?`,
      [itemId],
    );

    await conn.commit();

    logger.info({ event: "restore_item", itemId, actorId });

    return res.status(200).json({
      errorStatus: false,
      message: "Item restored successfully.",
      data: { itemId: Number(itemId) },
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// GET DELETED TRANSACTIONS — recycle bin list
// GET /deleted/transactions
// ══════════════════════════════════════════════════════════════════════════════
export const getDeletedTransactions = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page ?? 1, 10));
    const perPage = Math.min(100, parseInt(req.query.per_page ?? 20, 10));
    const offset = (page - 1) * perPage;

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM transaction_entry
       WHERE transaction_is_deleted = 1`,
    );

    const [rows] = await db.query(
      `SELECT
         t.transaction_id,
         t.transaction_idn,
         t.transaction_transaction_type,
         t.transaction_client,
         t.transaction_trucking_pn,
         t.transaction_date,
         t.transaction_status,
         t.transaction_deleted_at,
         t.transaction_delete_reason,
         u.user_username  AS deleted_by_username,
         u.user_firstname AS deleted_by_firstname,
         u.user_lastname  AS deleted_by_lastname,
         (SELECT COUNT(*) FROM hu_entry h
          WHERE h.hu_transaction_id = t.transaction_id
            AND h.hu_is_deleted = 1) AS deleted_hu_count,
         (SELECT COUNT(*) FROM items_entry i
          JOIN hu_entry h ON h.hu_id = i.items_hu_id
          WHERE h.hu_transaction_id = t.transaction_id
            AND i.items_is_deleted  = 1) AS deleted_item_count
       FROM transaction_entry t
       LEFT JOIN user_records u ON u.user_id = t.transaction_deleted_by
       WHERE t.transaction_is_deleted = 1
       ORDER BY t.transaction_deleted_at DESC
       LIMIT ? OFFSET ?`,
      [perPage, offset],
    );

    return res.status(200).json({
      errorStatus: false,
      data: rows,
      meta: {
        current_page: page,
        per_page: perPage,
        total,
        last_page: Math.ceil(total / perPage),
      },
    });
  } catch (err) {
    next(err);
  }
};
