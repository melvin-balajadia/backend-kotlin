import db from "../config/db.js";
import { paginate } from "../utils/paginate.js";

/* Create transaction */
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

  const sql = `
    INSERT INTO transaction_entry
    (transaction_idn, transaction_transaction_type, transaction_client, transaction_trucking_pn, transaction_date, transaction_start_date, transaction_end_date, transaction_start_time, transaction_end_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    },
  });
};

/* Update transaction */
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
      is_draft, // ← send true/false from frontend
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

    // 0 = Draft, 1 = Submitted for Approval
    const transaction_status = is_draft ? 0 : 1;

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
      transaction_status = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE transaction_id = ?
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
      transaction_status,
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
      message: is_draft ? "Saved as draft" : "Submitted for approval",
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
        transaction_status,
      },
    });
  } catch (err) {
    console.error("Update error:", err); // ← see the actual error
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/* Paginated data */
export const getPaginatedTransactions = async (req, res) => {
  let { page = 1, limit = 10 } = req.query;

  page = Number(page);
  limit = Number(limit);

  const offset = (page - 1) * limit;

  const [[{ total }]] = await db.query(
    "SELECT COUNT(*) AS total FROM transaction_entry WHERE transaction_status != 2",
  );
  const [rows] = await db.query(
    `SELECT * FROM transaction_entry
   WHERE transaction_status != 2
   ORDER BY transaction_id DESC
   LIMIT ? OFFSET ?`,
    [limit, offset],
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

/* Get all data */
export const getTransactionEntries = async (req, res) => {
  const [rows] = await db.query(
    "SELECT * FROM transaction_entry ORDER BY transaction_id DESC",
  );

  res.json({
    success: true,
    count: rows.length,
    data: rows,
  });
};

/* Paginated data */
export const getPaginatedTransactionEntries = async (req, res) => {
  try {
    const result = await paginate({
      query: req.query,
      table: "transaction_entry",
      db,
      baseCondition: "transaction_status != 2",
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

/* Get single record */
export const getTransactionEntryById = async (req, res) => {
  const { transactionId } = req.params;

  const [rows] = await db.query(
    "SELECT * FROM transaction_entry WHERE transaction_id = ?",
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

export const getTransactionReport = async (req, res) => {
  const { transactionId } = req.params;

  try {
    // 1. Get transaction details
    const [[transaction]] = await db.query(
      `SELECT * FROM transaction_entry WHERE transaction_id = ?`,
      [transactionId],
    );

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    // 2. Get all active HUs for this transaction
    const [hus] = await db.query(
      `SELECT * FROM hu_entry
       WHERE hu_transaction_id = ? AND hu_status = 0
       ORDER BY hu_id ASC`,
      [transactionId],
    );

    // 3. For each HU, get its active items
    const husWithItems = await Promise.all(
      hus.map(async (hu) => {
        const [items] = await db.query(
          `SELECT * FROM items_entry
           WHERE items_hu_id = ? AND items_status = 0
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

/**
 * PATCH /transactions/:transactionId/archive
 * Soft-deletes a transaction + all its HUs + all items under those HUs.
 * Entire operation is atomic — rolls back fully on any error.
 */
export const archiveTransaction = async (req, res) => {
  const { transactionId } = req.params;
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // 1. Verify transaction exists and is not already archived
    const [[tx]] = await conn.query(
      `SELECT transaction_id, transaction_status
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

    if (tx.transaction_status === 2) {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        message: "Transaction is already archived",
      });
    }

    // 2. Archive the transaction (status 2 = archived, keeps your 0/1 draft/submitted)
    await conn.query(
      `UPDATE transaction_entry
       SET transaction_status = 2, updated_at = CURRENT_TIMESTAMP
       WHERE transaction_id = ?`,
      [transactionId],
    );

    // 3. Get all HU ids under this transaction (active or not — archive everything)
    const [hus] = await conn.query(
      `SELECT hu_id FROM hu_entry WHERE hu_transaction_id = ?`,
      [transactionId],
    );

    let archivedHUs = 0;
    let archivedItems = 0;

    if (hus.length > 0) {
      const huIds = hus.map((h) => h.hu_id);
      const placeholders = huIds.map(() => "?").join(", ");

      // 4. Archive all HUs under this transaction
      const [huResult] = await conn.query(
        `UPDATE hu_entry
         SET hu_status = 2, updated_at = CURRENT_TIMESTAMP
         WHERE hu_transaction_id = ?`,
        [transactionId],
      );
      archivedHUs = huResult.affectedRows;

      // 5. Archive all items under those HUs
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
