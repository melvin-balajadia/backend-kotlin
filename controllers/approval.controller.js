// controllers/approval.controller.js
// ─────────────────────────────────────────────────────────────────────────────
// CHANGES vs original:
//
//  1. Import createNotification from notifications.controller.js
//  2. getTransaction() now also returns transaction_idn + transaction_created_by
//  3. New helper getApproversForTransaction() — finds all users whose group
//     has the "transaction:approve" permission so we know who to ping on submit
//  4. Each action (submit / approve / reject / return) fires the right
//     notifications INSIDE the same DB transaction via applyAction(),
//     so if the DB rolls back the notifications are never written either.
//  5. createTransaction() updated to save transaction_created_by = req.user.user_id
//     (see transactions.controller.js note at the bottom of this file)
//
//  Everything else — status constants, STEP_LABEL, applyAction shape,
//  HTTP responses — is IDENTICAL to the original.
// ─────────────────────────────────────────────────────────────────────────────

import db from "../config/db.js";
import AppError from "../utils/appError.js";
import { createNotification } from "./notifications.controller.js"; // NEW

// ─── Status constants — unchanged ─────────────────────────────────────────────
export const TX_STATUS = {
  DRAFT: 0,
  SUBMITTED: 1,
  CHECKED: 2,
  NOTED: 3,
  COMPLETED: 4,
  REJECTED: 5,
  RETURNED: 6,
};

const STEP_LABEL = {
  [TX_STATUS.DRAFT]: "Draft",
  [TX_STATUS.SUBMITTED]: "Submitted",
  [TX_STATUS.CHECKED]: "Checked by",
  [TX_STATUS.NOTED]: "Noted by",
  [TX_STATUS.COMPLETED]: "Completed",
  [TX_STATUS.REJECTED]: "Rejected",
  [TX_STATUS.RETURNED]: "Returned",
};

// ─── UPDATED: now also fetches idn + created_by for notification messages ─────
const getTransaction = async (id) => {
  const [[row]] = await db.query(
    `SELECT transaction_id,
            transaction_status,
            transaction_idn,
            transaction_created_by
     FROM   transaction_entry
     WHERE  transaction_id = ?
     LIMIT  1`,
    [id],
  );
  return row ?? null;
};

// ─── NEW: find all users whose group has "transaction:approve" permission ──────
// These are the people we notify when a creator submits a transaction.
const getApproversForTransaction = async () => {
  const [rows] = await db.query(
    `SELECT DISTINCT u.user_id
     FROM   user_records u
     JOIN   group_permissions gp ON gp.group_id = u.user_groupid
     JOIN   permissions p        ON p.permission_id = gp.permission_id
     WHERE  p.permission_key = 'transaction:approve'
     AND    u.user_status    = 'active'`,
  );
  return rows.map((r) => r.user_id);
};

// ─── UPDATED: applyAction now accepts a `notifications` array ─────────────────
// Each item: { userId, kind, title, message, href }
// They are inserted inside the SAME connection so they roll back together.
const applyAction = async ({
  transactionId,
  action,
  fromStatus,
  toStatus,
  actor,
  comment,
  stepLabel,
  notifications = [], // NEW param — defaults to empty so old callers still work
}) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Advance transaction status — unchanged
    await conn.query(
      `UPDATE transaction_entry
       SET    transaction_status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE  transaction_id = ?`,
      [toStatus, transactionId],
    );

    // 2. Write audit log — unchanged
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
        actor.user_id,
        actor.user_name,
        stepLabel ?? STEP_LABEL[toStatus],
        comment ?? null,
      ],
    );

    // 3. NEW — write all notifications atomically
    for (const n of notifications) {
      await createNotification({ ...n, conn });
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /transaction-entry/:id/submit
// Requestor submits → notify every approver
// ─────────────────────────────────────────────────────────────────────────────
export const submitTransaction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tx = await getTransaction(id);

    if (!tx) return next(new AppError("Transaction not found.", 404));

    const allowedFrom = [TX_STATUS.DRAFT, TX_STATUS.RETURNED];
    if (!allowedFrom.includes(tx.transaction_status)) {
      return next(
        new AppError(
          `Cannot submit — transaction is currently in "${STEP_LABEL[tx.transaction_status]}" status.`,
          409,
        ),
      );
    }

    // NEW — build one notification per approver
    const approverIds = await getApproversForTransaction();
    const idn = tx.transaction_idn ?? `#${id}`;
    const href = `/transaction-entries/edit/${id}`;

    const isResubmit = tx.transaction_status === TX_STATUS.RETURNED;

    const notifications = approverIds.map((userId) => ({
      userId,
      kind: "info",
      title: isResubmit
        ? `Transaction ${idn} re-submitted`
        : `Transaction ${idn} awaiting approval`,
      message: isResubmit
        ? `${req.user.user_name} has revised and re-submitted transaction ${idn}. Please review.`
        : `${req.user.user_name} submitted transaction ${idn} for your approval.`,
      href,
    }));

    await applyAction({
      transactionId: id,
      action: "submit",
      fromStatus: tx.transaction_status,
      toStatus: TX_STATUS.SUBMITTED,
      actor: req.user,
      comment: req.body.comment ?? null,
      notifications, // NEW
    });

    return res.status(200).json({
      errorStatus: false,
      message: "Transaction submitted for approval.",
      data: { transaction_status: TX_STATUS.SUBMITTED },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /transaction-entry/:id/approve
// Approver advances → notify the requestor, and on first approval also
// notify other approvers that the second signature is now needed.
// ─────────────────────────────────────────────────────────────────────────────
export const approveTransaction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tx = await getTransaction(id);

    if (!tx) return next(new AppError("Transaction not found.", 404));

    const progressMap = {
      [TX_STATUS.SUBMITTED]: TX_STATUS.CHECKED,
      [TX_STATUS.CHECKED]: TX_STATUS.COMPLETED,
    };
    const approvalStepLabel = {
      [TX_STATUS.SUBMITTED]: "Checked by",
      [TX_STATUS.CHECKED]: "Noted by",
    };

    const nextStatus = progressMap[tx.transaction_status];
    if (nextStatus === undefined) {
      return next(
        new AppError(
          `Cannot approve — transaction is currently in "${STEP_LABEL[tx.transaction_status]}" status.`,
          409,
        ),
      );
    }

    const idn = tx.transaction_idn ?? `#${id}`;
    const href = `/transaction-entries/edit/${id}`;
    const notifications = [];

    // Always notify the requestor
    if (tx.transaction_created_by) {
      if (nextStatus === TX_STATUS.COMPLETED) {
        // Final approval — transaction is done
        notifications.push({
          userId: tx.transaction_created_by,
          kind: "success",
          title: `Transaction ${idn} completed`,
          message: `Your transaction ${idn} has been fully approved and marked as Completed by ${req.user.user_name}.`,
          href,
        });
      } else {
        // First approval — still needs second signature
        notifications.push({
          userId: tx.transaction_created_by,
          kind: "info",
          title: `Transaction ${idn} — first approval done`,
          message: `${req.user.user_name} has checked transaction ${idn}. It is now awaiting the final "Noted by" approval.`,
          href,
        });
      }
    }

    // On first approval: notify other approvers (except the one who just acted)
    // so someone else can complete the "Noted by" step
    if (nextStatus === TX_STATUS.CHECKED) {
      const approverIds = await getApproversForTransaction();
      for (const userId of approverIds) {
        if (userId === req.user.user_id) continue; // don't self-notify
        notifications.push({
          userId,
          kind: "info",
          title: `Transaction ${idn} needs final approval`,
          message: `${req.user.user_name} completed the "Checked by" step on transaction ${idn}. The "Noted by" approval is now pending.`,
          href,
        });
      }
    }

    await applyAction({
      transactionId: id,
      action: "approve",
      fromStatus: tx.transaction_status,
      toStatus: nextStatus,
      actor: req.user,
      comment: req.body.comment ?? null,
      stepLabel: approvalStepLabel[tx.transaction_status],
      notifications, // NEW
    });

    return res.status(200).json({
      errorStatus: false,
      message: `Transaction approved. New status: ${STEP_LABEL[nextStatus]}.`,
      data: { transaction_status: nextStatus },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /transaction-entry/:id/reject
// Approver rejects → notify only the requestor, permanently stopped
// ─────────────────────────────────────────────────────────────────────────────
export const rejectTransaction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tx = await getTransaction(id);

    if (!tx) return next(new AppError("Transaction not found.", 404));

    const approvableStatuses = [TX_STATUS.SUBMITTED, TX_STATUS.CHECKED];
    if (!approvableStatuses.includes(tx.transaction_status)) {
      return next(
        new AppError(
          `Cannot reject — transaction is currently in "${STEP_LABEL[tx.transaction_status]}" status.`,
          409,
        ),
      );
    }

    const idn = tx.transaction_idn ?? `#${id}`;
    const href = `/transaction-entries/edit/${id}`;

    const notifications = [];

    if (tx.transaction_created_by) {
      notifications.push({
        userId: tx.transaction_created_by,
        kind: "error",
        title: `Transaction ${idn} rejected`,
        message: req.body.comment
          ? `${req.user.user_name} rejected transaction ${idn}: "${req.body.comment}"`
          : `${req.user.user_name} has rejected transaction ${idn}.`,
        href,
      });
    }

    await applyAction({
      transactionId: id,
      action: "reject",
      fromStatus: tx.transaction_status,
      toStatus: TX_STATUS.REJECTED,
      actor: req.user,
      comment: req.body.comment ?? null,
      notifications, // NEW
    });

    return res.status(200).json({
      errorStatus: false,
      message: "Transaction rejected.",
      data: { transaction_status: TX_STATUS.REJECTED },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /transaction-entry/:id/return
// Approver returns for revision → notify only the requestor with the reason
// ─────────────────────────────────────────────────────────────────────────────
export const returnTransaction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tx = await getTransaction(id);

    if (!tx) return next(new AppError("Transaction not found.", 404));

    const approvableStatuses = [TX_STATUS.SUBMITTED, TX_STATUS.CHECKED];
    if (!approvableStatuses.includes(tx.transaction_status)) {
      return next(
        new AppError(
          `Cannot return — transaction is currently in "${STEP_LABEL[tx.transaction_status]}" status.`,
          409,
        ),
      );
    }

    const idn = tx.transaction_idn ?? `#${id}`;
    const href = `/transaction-entries/edit/${id}`;

    const notifications = [];

    if (tx.transaction_created_by) {
      notifications.push({
        userId: tx.transaction_created_by,
        kind: "warning",
        title: `Transaction ${idn} returned for revision`,
        message: req.body.comment
          ? `${req.user.user_name} returned transaction ${idn} for revision: "${req.body.comment}"`
          : `${req.user.user_name} returned transaction ${idn}. Please review and re-submit.`,
        href,
      });
    }

    await applyAction({
      transactionId: id,
      action: "return",
      fromStatus: tx.transaction_status,
      toStatus: TX_STATUS.RETURNED,
      actor: req.user,
      comment: req.body.comment ?? null,
      notifications, // NEW
    });

    return res.status(200).json({
      errorStatus: false,
      message: "Transaction returned to creator for revision.",
      data: { transaction_status: TX_STATUS.RETURNED },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /transaction-entry/:id/logs — UNCHANGED
// ─────────────────────────────────────────────────────────────────────────────
export const getApprovalLogs = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      `SELECT log_id, log_action, log_from_status, log_to_status,
              log_actor_id, log_actor_name, log_step_label, log_comment, log_created_at
       FROM   transaction_approval_logs
       WHERE  log_transaction_id = ?
       ORDER  BY log_created_at ASC`,
      [id],
    );

    return res.status(200).json({ errorStatus: false, data: rows });
  } catch (err) {
    next(err);
  }
};
