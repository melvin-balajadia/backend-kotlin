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
export const getPaginatedTransactionEntries = async (req, res) => {
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
