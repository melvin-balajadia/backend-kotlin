import db from "../config/db.js";

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
    "SELECT COUNT(*) AS total FROM transaction_entry",
  );

  const [rows] = await db.query(
    `SELECT * FROM transaction_entry
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
  let {
    page = 1,
    per_page = 10,
    search = "",
    sort_by = "transaction_id",
    sort_dir = "desc",
    // column-level filters (must match your column keys)
    transaction_idn,
    transaction_transaction_type,
    transaction_client,
    transaction_trucking_pn,
    transaction_date,
  } = req.query;

  page = Number(page);
  per_page = Number(per_page);
  const offset = (page - 1) * per_page;

  // ── Whitelist sortable columns to prevent SQL injection ──────────────────
  const allowedSortColumns = [
    "transaction_id",
    "transaction_idn",
    "transaction_transaction_type",
    "transaction_client",
    "transaction_trucking_pn",
    "transaction_date",
  ];
  if (!allowedSortColumns.includes(sort_by)) sort_by = "transaction_id";
  if (!["asc", "desc"].includes(sort_dir.toLowerCase())) sort_dir = "desc";

  // ── Build WHERE clause ───────────────────────────────────────────────────
  const conditions = [];
  const values = [];

  if (search) {
    conditions.push(`(
      transaction_idn              LIKE ? OR
      transaction_transaction_type LIKE ? OR
      transaction_client           LIKE ? OR
      transaction_trucking_pn      LIKE ?
    )`);
    const like = `%${search}%`;
    values.push(like, like, like, like);
  }

  // Column-level filters
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

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  // ── Count total matching rows ────────────────────────────────────────────
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM transaction_entry ${where}`,
    values,
  );

  // ── Fetch paginated rows ─────────────────────────────────────────────────
  const [rows] = await db.query(
    `SELECT * FROM transaction_entry
     ${where}
     ORDER BY ${sort_by} ${sort_dir}
     LIMIT ? OFFSET ?`,
    [...values, per_page, offset],
  );

  // ── Respond in the shape your frontend expects ───────────────────────────
  res.json({
    data: rows,
    meta: {
      current_page: page,
      per_page,
      total,
      last_page: Math.ceil(total / per_page),
    },
  });
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
