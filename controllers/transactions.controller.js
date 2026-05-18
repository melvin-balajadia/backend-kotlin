// controllers/transactions.controller.js
import db from "../config/db.js";
import { paginate } from "../utils/paginate.js";

const DRAFT_STATUS = 0;
const RETURNED_STATUS = 6;
const ARCHIVED_STATUS = 7;

// ─────────────────────────────────────────────────────────────────────────────
// CREATE
// POST /transaction-entry
// ─────────────────────────────────────────────────────────────────────────────
// CHANGED: added transaction_created_by = req.user.user_id on INSERT.
// req.user is already populated by verifyJWT (the route uses it), so no
// new middleware is needed. This column is what approval.controller.js
// reads to know who to notify when an approver acts on the transaction.
// ─────────────────────────────────────────────────────────────────────────────
export const createTransactionEntries = async (req, res) => {
  const {
    transaction_idn,
    transaction_transaction_type,
    transaction_client,
    transaction_trucking_pn,
    transaction_date,
    transaction_start_date,
    transaction_end_date,
    transaction_start_time,
    transaction_end_time,
  } = req.body;

  if (
    !transaction_idn ||
    !transaction_transaction_type ||
    !transaction_client ||
    !transaction_trucking_pn ||
    !transaction_date
  ) {
    return res.status(400).json({
      success: false,
      message: "All fields are required",
    });
  }

  // NEW — req.user.user_id is injected by verifyJWT
  const createdBy = req.user?.user_id ?? null;

  const sql = `
    INSERT INTO transaction_entry
    (transaction_idn, transaction_transaction_type, transaction_client,
     transaction_trucking_pn, transaction_date, transaction_start_date,
     transaction_end_date, transaction_start_time, transaction_end_time,
     transaction_created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const [result] = await db.query(sql, [
    transaction_idn,
    transaction_transaction_type,
    transaction_client,
    transaction_trucking_pn,
    transaction_date,
    transaction_start_date,
    transaction_end_date,
    transaction_start_time,
    transaction_end_time,
    createdBy, // NEW
  ]);

  res.status(201).json({
    success: true,
    message: "Data saved successfully",
    data: {
      transaction_id: result.insertId,
      transaction_idn,
      transaction_transaction_type,
      transaction_client,
      transaction_trucking_pn,
      transaction_date,
      transaction_start_date,
      transaction_end_date,
      transaction_start_time,
      transaction_end_time,
      transaction_created_by: createdBy, // NEW
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE — UNCHANGED
// PUT /transaction-entry/:transactionId
// ─────────────────────────────────────────────────────────────────────────────
export const updateTransactionEntries = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const {
      transaction_idn,
      transaction_transaction_type,
      transaction_client,
      transaction_trucking_pn,
      transaction_date,
      transaction_start_date,
      transaction_end_date,
      transaction_start_time,
      transaction_end_time,
      is_draft,
    } = req.body;

    if (
      !transaction_idn ||
      !transaction_transaction_type ||
      !transaction_client ||
      !transaction_trucking_pn ||
      !transaction_date
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    // Exclude soft-deleted records from update
    const [[tx]] = await db.query(
      `SELECT transaction_status, transaction_is_deleted
       FROM transaction_entry
       WHERE transaction_id = ?
         AND transaction_is_deleted = 0
       LIMIT 1`,
      [transactionId],
    );

    if (!tx) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    const nextStatus =
      is_draft === true && tx.transaction_status !== RETURNED_STATUS
        ? DRAFT_STATUS
        : tx.transaction_status;

    const statusAssignment =
      is_draft === true ? "      transaction_status = ?,\n" : "";

    const sql = `
      UPDATE transaction_entry
      SET
        transaction_idn = ?,
        transaction_transaction_type = ?,
        transaction_client = ?,
        transaction_trucking_pn = ?,
        transaction_date = ?,
        transaction_start_date = ?,
        transaction_end_date = ?,
        transaction_start_time = ?,
        transaction_end_time = ?,
${statusAssignment}
        updated_at = CURRENT_TIMESTAMP
      WHERE transaction_id = ?
        AND transaction_is_deleted = 0
    `;

    const [result] = await db.query(sql, [
      transaction_idn,
      transaction_transaction_type,
      transaction_client,
      transaction_trucking_pn,
      transaction_date,
      transaction_start_date,
      transaction_end_date,
      transaction_start_time,
      transaction_end_time,
      ...(is_draft === true ? [nextStatus] : []),
      transactionId,
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    res.status(200).json({
      success: true,
      message: is_draft ? "Saved as draft" : "Transaction updated",
      data: {
        transaction_id: transactionId,
        transaction_idn,
        transaction_transaction_type,
        transaction_client,
        transaction_trucking_pn,
        transaction_date,
        transaction_start_date,
        transaction_end_date,
        transaction_start_time,
        transaction_end_time,
        transaction_status: nextStatus,
      },
    });
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET ALL (simple list, no pagination) — UNCHANGED
// GET /transaction-entry
// ─────────────────────────────────────────────────────────────────────────────
export const getTransactionEntries = async (req, res) => {
  const [rows] = await db.query(
    `SELECT * FROM transaction_entry
     WHERE transaction_status    != ?
       AND transaction_is_deleted = 0
     ORDER BY transaction_id DESC`,
    [ARCHIVED_STATUS],
  );

  res.json({
    success: true,
    count: rows.length,
    data: rows,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET PAGINATED (legacy endpoint) — UNCHANGED
// GET /paginated-transaction-entry
// ─────────────────────────────────────────────────────────────────────────────
export const getPaginatedTransactions = async (req, res) => {
  let { page = 1, limit = 10 } = req.query;

  page = Number(page);
  limit = Number(limit);

  const offset = (page - 1) * limit;

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total
     FROM transaction_entry
     WHERE transaction_status    != ?
       AND transaction_is_deleted = 0`,
    [ARCHIVED_STATUS],
  );

  const [rows] = await db.query(
    `SELECT * FROM transaction_entry
     WHERE transaction_status    != ?
       AND transaction_is_deleted = 0
     ORDER BY transaction_id DESC
     LIMIT ? OFFSET ?`,
    [ARCHIVED_STATUS, limit, offset],
  );

  res.json({
    success: true,
    page,
    limit,
    totalRecords: total,
    totalPages: Math.ceil(total / limit),
    data: rows,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET PAGINATED (main DataTable endpoint) — UNCHANGED
// GET /paginated-transaction
// ─────────────────────────────────────────────────────────────────────────────
export const getPaginatedTransactionEntries = async (req, res) => {
  try {
    const result = await paginate({
      query: req.query,
      table: "transaction_entry",
      db,
      baseCondition: `transaction_status != ${ARCHIVED_STATUS} AND transaction_is_deleted = 0`,
      searchColumns: [
        "transaction_idn",
        "transaction_transaction_type",
        "transaction_client",
        "transaction_trucking_pn",
      ],
      allowedSorts: [
        "transaction_id",
        "transaction_idn",
        "transaction_transaction_type",
        "transaction_client",
        "transaction_trucking_pn",
        "transaction_date",
      ],
      defaultSort: "transaction_id",
      filters: (query, conditions, values) => {
        const {
          transaction_idn,
          transaction_transaction_type,
          transaction_client,
          transaction_trucking_pn,
          transaction_date,
        } = query;

        if (transaction_idn) {
          conditions.push("transaction_idn LIKE ?");
          values.push(`%${transaction_idn}%`);
        }
        if (transaction_transaction_type) {
          conditions.push("transaction_transaction_type LIKE ?");
          values.push(`%${transaction_transaction_type}%`);
        }
        if (transaction_client) {
          conditions.push("transaction_client LIKE ?");
          values.push(`%${transaction_client}%`);
        }
        if (transaction_trucking_pn) {
          conditions.push("transaction_trucking_pn LIKE ?");
          values.push(`%${transaction_trucking_pn}%`);
        }
        if (transaction_date) {
          conditions.push("DATE(transaction_date) = ?");
          values.push(transaction_date);
        }
      },
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET SINGLE — UNCHANGED
// GET /transaction-entry/:transactionId
// ─────────────────────────────────────────────────────────────────────────────
export const getTransactionEntryById = async (req, res) => {
  const { transactionId } = req.params;

  const [rows] = await db.query(
    `SELECT * FROM transaction_entry
     WHERE transaction_id         = ?
       AND transaction_is_deleted = 0`,
    [transactionId],
  );

  if (!rows.length) {
    return res.status(404).json({
      success: false,
      message: "Data not found",
    });
  }

  res.json({
    success: true,
    data: rows[0],
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET REPORT — UNCHANGED
// GET /transaction-report/:transactionId
// ─────────────────────────────────────────────────────────────────────────────
export const getTransactionReport = async (req, res) => {
  const { transactionId } = req.params;

  try {
    const [[transaction]] = await db.query(
      `SELECT * FROM transaction_entry
       WHERE transaction_id        = ?
         AND transaction_is_deleted = 0`,
      [transactionId],
    );

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    const [hus] = await db.query(
      `SELECT * FROM hu_entry
       WHERE hu_transaction_id = ?
         AND hu_status          = 0
         AND hu_is_deleted      = 0
       ORDER BY hu_id ASC`,
      [transactionId],
    );

    const husWithItems = await Promise.all(
      hus.map(async (hu) => {
        const [items] = await db.query(
          `SELECT * FROM items_entry
           WHERE items_hu_id     = ?
             AND items_status    = 0
             AND items_is_deleted = 0
           ORDER BY items_id ASC`,
          [hu.hu_id],
        );
        return { ...hu, items };
      }),
    );

    return res.json({
      success: true,
      data: {
        ...transaction,
        hu_list: husWithItems,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ARCHIVE — UNCHANGED
// PATCH /transaction-report/:transactionId/archive
// ─────────────────────────────────────────────────────────────────────────────
export const archiveTransaction = async (req, res) => {
  const { transactionId } = req.params;
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [[tx]] = await conn.query(
      `SELECT transaction_id, transaction_status, transaction_is_deleted
       FROM transaction_entry
       WHERE transaction_id = ?`,
      [transactionId],
    );

    if (!tx) {
      await conn.rollback();
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    if (tx.transaction_is_deleted) {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        message: "Cannot archive a soft-deleted transaction. Restore it first.",
      });
    }

    if (tx.transaction_status === ARCHIVED_STATUS) {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        message: "Transaction is already archived",
      });
    }

    await conn.query(
      `UPDATE transaction_entry
       SET transaction_status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE transaction_id   = ?`,
      [ARCHIVED_STATUS, transactionId],
    );

    const [hus] = await conn.query(
      `SELECT hu_id FROM hu_entry WHERE hu_transaction_id = ?`,
      [transactionId],
    );

    let archivedHUs = 0;
    let archivedItems = 0;

    if (hus.length > 0) {
      const huIds = hus.map((h) => h.hu_id);
      const placeholders = huIds.map(() => "?").join(", ");

      const [huResult] = await conn.query(
        `UPDATE hu_entry
         SET hu_status = 2, updated_at = CURRENT_TIMESTAMP
         WHERE hu_transaction_id = ?`,
        [transactionId],
      );
      archivedHUs = huResult.affectedRows;

      const [itemResult] = await conn.query(
        `UPDATE items_entry
         SET items_status = 2, updated_at = CURRENT_TIMESTAMP
         WHERE items_hu_id IN (${placeholders})`,
        huIds,
      );
      archivedItems = itemResult.affectedRows;
    }

    await conn.commit();

    return res.status(200).json({
      success: true,
      message: "Transaction archived successfully",
      data: {
        transaction_id: Number(transactionId),
        archived_hus: archivedHUs,
        archived_items: archivedItems,
      },
    });
  } catch (err) {
    await conn.rollback();
    console.error("archiveTransaction error:", err);
    return res.status(500).json({
      success: false,
      message: "Archive failed",
      error: err.message,
    });
  } finally {
    conn.release();
  }
};
