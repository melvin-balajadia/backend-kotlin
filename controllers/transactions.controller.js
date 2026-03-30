import db from "../config/db.js";

/* Create transaction */
export const createTransactionEntries = async (req, res) => {
  const {
    transaction_idn,
    transaction_transaction_type,
    transaction_client,
    transaction_trucking_pn,
    transaction_date,
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
    (transaction_idn, transaction_transaction_type, transaction_client, transaction_trucking_pn, transaction_date)
    VALUES (?, ?, ?, ?, ?)
  `;

  const [result] = await db.query(sql, [
    transaction_idn,
    transaction_transaction_type,
    transaction_client,
    transaction_trucking_pn,
    transaction_date,
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
    },
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
/* GET /api/transactions */
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
