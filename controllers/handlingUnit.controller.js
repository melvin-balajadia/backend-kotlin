import db from "../config/db.js";

/* Create HU data */
export const createHUEntries = async (req, res) => {
  const { hu_transaction_id, hu_number, hu_batch_code } = req.body;
  if (!hu_transaction_id || !hu_number || !hu_batch_code) {
    return res.status(400).json({
      success: false,
      message: "All fields are required",
    });
  }

  const sql = `
    INSERT INTO hu_entry
    (hu_transaction_id, hu_number, hu_batch_code)
    VALUES (?, ?, ?)
  `;

  const [result] = await db.query(sql, [
    hu_transaction_id,
    hu_number,
    hu_batch_code,
  ]);

  res.status(201).json({
    success: true,
    message: "Data saved successfully",
    data: {
      hu_id: result.insertId,
      hu_transaction_id,
      hu_number,
      hu_batch_code,
    },
  });
};

/* Get all HU by transaction id */
export const getHUByTransactionId = async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await db.query(
      "SELECT * FROM hu_entry WHERE hu_transaction_id = ? AND hu_status != 2",
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

/* Update item entry by ID */
export const updateHUEntry = async (req, res) => {
  const { huId } = req.params;
  const fields = req.body;

  // Whitelist allowed columns — never trust raw req.body keys in a SET clause
  const ALLOWED_FIELDS = [
    "hu_number",
    "hu_palletnumber",
    "hu_batch_code",
    "hu_description",
  ];

  try {
    const [existing] = await db.query(
      "SELECT * FROM hu_entry WHERE hu_id = ? AND hu_status = 0",
      [huId],
    );

    if (!existing.length) {
      return res.status(404).json({
        success: false,
        message: "No HU found",
      });
    }

    // Only keep fields that are explicitly allowed
    const safeFields = Object.keys(fields).filter((k) =>
      ALLOWED_FIELDS.includes(k),
    );

    if (!safeFields.length) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update",
      });
    }

    const setClause = safeFields.map((k) => `${k} = ?`).join(", ");
    const values = [...safeFields.map((k) => fields[k]), huId];

    await db.query(
      `UPDATE hu_entry SET ${setClause}, updated_at = CURRENT_TIMESTAMP
       WHERE hu_id = ? AND hu_status = 0`,
      values,
    );

    res.json({ success: true, message: "HU updated successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /hu/:huId/archive
 * Soft-deletes a single HU + all items inside it.
 * Does NOT touch the parent transaction.
 */
export const archiveHU = async (req, res) => {
  const { huId } = req.params;
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // 1. Verify HU exists
    const [[hu]] = await conn.query(
      `SELECT hu_id, hu_status FROM hu_entry WHERE hu_id = ?`,
      [huId],
    );

    if (!hu) {
      await conn.rollback();
      return res.status(404).json({
        success: false,
        message: "HU not found",
      });
    }

    if (hu.hu_status === 2) {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        message: "HU is already archived",
      });
    }

    // 2. Archive the HU
    await conn.query(
      `UPDATE hu_entry
       SET hu_status = 2, updated_at = CURRENT_TIMESTAMP
       WHERE hu_id = ?`,
      [huId],
    );

    // 3. Archive all items under this HU
    const [itemResult] = await conn.query(
      `UPDATE items_entry
       SET items_status = 2, updated_at = CURRENT_TIMESTAMP
       WHERE items_hu_id = ?`,
      [huId],
    );

    await conn.commit();

    return res.status(200).json({
      success: true,
      message: "HU and its items archived successfully",
      data: {
        hu_id: Number(huId),
        archived_items: itemResult.affectedRows,
      },
    });
  } catch (err) {
    await conn.rollback();
    console.error("archiveHU error:", err);
    return res.status(500).json({
      success: false,
      message: "Archive failed",
      error: err.message,
    });
  } finally {
    conn.release();
  }
};
