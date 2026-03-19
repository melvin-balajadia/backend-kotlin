import db from "../config/db.js";

/* Create HU data */
export const createHUEntries = async (req, res) => {
  const { hu_transaction_id, hu_number } = req.body;

  if (!hu_transaction_id || !hu_number) {
    return res.status(400).json({
      success: false,
      message: "All fields are required",
    });
  }

  const sql = `
    INSERT INTO hu_entry
    (hu_transaction_id, hu_number)
    VALUES (?, ?)
  `;

  const [result] = await db.query(sql, [hu_transaction_id, hu_number]);

  res.status(201).json({
    success: true,
    message: "Data saved successfully",
    data: {
      hu_id: result.insertId,
      hu_transaction_id,
      hu_number,
    },
  });
};

/* Get all HU by transaction id */
export const getHUByTransactionId = async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await db.query(
      "SELECT * FROM hu_entry WHERE hu_transaction_id = ?",
      [id],
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "No HU found for this transaction",
      });
    }

    res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* Paginated data */
export const getPaginatedHUEntries = async (req, res) => {
  let { page = 1, limit = 10 } = req.query;

  page = Number(page);
  limit = Number(limit);

  const offset = (page - 1) * limit;

  const [[{ total }]] = await db.query(
    "SELECT COUNT(*) AS total FROM hu_entry",
  );

  const [rows] = await db.query(
    `SELECT * FROM hu_entry
     ORDER BY hu_id DESC
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
