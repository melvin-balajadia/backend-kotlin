// controllers/approval.controller.js
import db from "../config/db.js";
import AppError from "../utils/appError.js";

// ─── Status constants ─────────────────────────────────────────────────────────
export const TX_STATUS = {
  DRAFT: 0,
  SUBMITTED: 1,
  CHECKED: 2, // Checked by approved
  NOTED: 3, // Noted by approved
  COMPLETED: 4,
  REJECTED: 5,
  RETURNED: 6,
};

// Maps each status to a human-readable step label for the audit log
const STEP_LABEL = {
  [TX_STATUS.DRAFT]: "Draft",
  [TX_STATUS.SUBMITTED]: "Submitted",
  [TX_STATUS.CHECKED]: "Checked by",
  [TX_STATUS.NOTED]: "Noted by",
  [TX_STATUS.COMPLETED]: "Completed",
  [TX_STATUS.REJECTED]: "Rejected",
  [TX_STATUS.RETURNED]: "Returned",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetches a transaction by ID.
 * Returns null if not found.
 */
const getTransaction = async (id) => {
  const [[row]] = await db.query(
    "SELECT transaction_id, transaction_status FROM transaction_entry WHERE transaction_id = ? LIMIT 1",
    [id],
  );
  return row ?? null;
};

/**
 * Updates transaction_status and writes an audit log row in a single transaction.
 */
const applyAction = async ({
  transactionId,
  action,
  fromStatus,
  toStatus,
  actor,
  comment,
}) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      "UPDATE transaction_entry SET transaction_status = ? WHERE transaction_id = ?",
      [toStatus, transactionId],
    );

    await conn.query(
      "INSERT INTO transaction_approval_logs " +
        "(log_transaction_id, log_action, log_from_status, log_to_status, " +
        "log_actor_id, log_actor_name, log_step_label, log_comment) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        transactionId,
        action,
        fromStatus,
        toStatus,
        actor.user_id,
        actor.user_name,
        STEP_LABEL[toStatus],
        comment ?? null,
      ],
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─── POST /transaction-entry/:id/submit ───────────────────────────────────────
/**
 * Creator submits a draft for approval.
 * Allowed from: DRAFT (0) or RETURNED (6)
 */
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

    await applyAction({
      transactionId: id,
      action: "submit",
      fromStatus: tx.transaction_status,
      toStatus: TX_STATUS.SUBMITTED,
      actor: req.user,
      comment: req.body.comment ?? null,
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

// ─── POST /transaction-entry/:id/approve ─────────────────────────────────────
/**
 * Approver advances the transaction one step forward.
 * SUBMITTED(1) → CHECKED(2) → NOTED(3) → COMPLETED(4)
 */
export const approveTransaction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tx = await getTransaction(id);

    if (!tx) return next(new AppError("Transaction not found.", 404));

    const progressMap = {
      [TX_STATUS.SUBMITTED]: TX_STATUS.CHECKED,
      [TX_STATUS.CHECKED]: TX_STATUS.NOTED,
      [TX_STATUS.NOTED]: TX_STATUS.COMPLETED,
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

    await applyAction({
      transactionId: id,
      action: "approve",
      fromStatus: tx.transaction_status,
      toStatus: nextStatus,
      actor: req.user,
      comment: req.body.comment ?? null,
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

// ─── POST /transaction-entry/:id/reject ──────────────────────────────────────
/**
 * Approver permanently rejects the transaction.
 * Only allowed when pending approval (status 1, 2, or 3).
 */
export const rejectTransaction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tx = await getTransaction(id);

    if (!tx) return next(new AppError("Transaction not found.", 404));

    const approvableStatuses = [
      TX_STATUS.SUBMITTED,
      TX_STATUS.CHECKED,
      TX_STATUS.NOTED,
    ];
    if (!approvableStatuses.includes(tx.transaction_status)) {
      return next(
        new AppError(
          `Cannot reject — transaction is currently in "${STEP_LABEL[tx.transaction_status]}" status.`,
          409,
        ),
      );
    }

    await applyAction({
      transactionId: id,
      action: "reject",
      fromStatus: tx.transaction_status,
      toStatus: TX_STATUS.REJECTED,
      actor: req.user,
      comment: req.body.comment ?? null,
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

// ─── POST /transaction-entry/:id/return ──────────────────────────────────────
/**
 * Approver returns the transaction to the creator for revision.
 * Creator can then edit and re-submit.
 * Only allowed when pending approval (status 1, 2, or 3).
 */
export const returnTransaction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tx = await getTransaction(id);

    if (!tx) return next(new AppError("Transaction not found.", 404));

    const approvableStatuses = [
      TX_STATUS.SUBMITTED,
      TX_STATUS.CHECKED,
      TX_STATUS.NOTED,
    ];
    if (!approvableStatuses.includes(tx.transaction_status)) {
      return next(
        new AppError(
          `Cannot return — transaction is currently in "${STEP_LABEL[tx.transaction_status]}" status.`,
          409,
        ),
      );
    }

    await applyAction({
      transactionId: id,
      action: "return",
      fromStatus: tx.transaction_status,
      toStatus: TX_STATUS.RETURNED,
      actor: req.user,
      comment: req.body.comment ?? null,
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

// ─── GET /transaction-entry/:id/logs ─────────────────────────────────────────
/**
 * Returns the full approval history for a transaction.
 * Used by the frontend timeline to show actor names and dates.
 */
export const getApprovalLogs = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      "SELECT log_id, log_action, log_from_status, log_to_status, " +
        "log_actor_id, log_actor_name, log_step_label, log_comment, log_created_at " +
        "FROM transaction_approval_logs " +
        "WHERE log_transaction_id = ? " +
        "ORDER BY log_created_at ASC",
      [id],
    );

    return res.status(200).json({ errorStatus: false, data: rows });
  } catch (err) {
    next(err);
  }
};
