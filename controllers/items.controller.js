import db from "../config/db.js";

export const bulkUpsertItems = async (req, res) => {
  const { hu_id, items } = req.body;
  console.log(req.body);
  if (!hu_id || !Array.isArray(items)) {
    return res.status(400).json({
      success: false,
      message: "Invalid payload",
    });
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // 1. Normalize
    const cleanItems = items.map((item) => ({
      items_id: item.items_id && item.items_id > 0 ? item.items_id : null,
      items_batch_code: item.items_batch_code ?? null,
      items_production_code: item.items_production_code ?? null,
      items_pd: item.items_pd ?? null,
      items_cu: item.items_cu ?? null,
      items_weight: item.items_weight ?? null,
    }));
    // 2. Split items
    const existingItems = cleanItems.filter(
      (i) => i.items_id && i.items_id > 0,
    );
    const newItems = cleanItems.filter((i) => !i.items_id || i.items_id <= 0);
    const existingIds = existingItems.map((i) => i.items_id);
    // 3. Soft delete removed items
    if (existingIds.length > 0) {
      const placeholders = existingIds.map(() => "?").join(", ");
      await conn.query(
        `UPDATE items_entry
         SET items_status = 1, updated_at = CURRENT_TIMESTAMP
         WHERE items_hu_id = ?
         AND items_id NOT IN (${placeholders})
         AND items_status = 0`,
        [hu_id, ...existingIds],
      );
    } else {
      // ✅ empty list = soft delete ALL
      await conn.query(
        `UPDATE items_entry
         SET items_status = 1, updated_at = CURRENT_TIMESTAMP
         WHERE items_hu_id = ?
         AND items_status = 0`,
        [hu_id],
      );
    }
    // 4. Update existing items
    for (const item of existingItems) {
      await conn.query(
        `UPDATE items_entry
         SET
           items_batch_code = ?,
           items_production_code = ?,
           items_pd = ?,
           items_cu = ?,
           items_weight = ?,
           items_status = 0,
           updated_at = CURRENT_TIMESTAMP
         WHERE items_id = ?
         AND items_hu_id = ?`,
        [
          item.items_batch_code,
          item.items_production_code,
          item.items_pd,
          item.items_cu,
          item.items_weight,
          item.items_id,
          hu_id,
        ],
      );
    }
    // 5. Insert new items
    if (newItems.length > 0) {
      const values = newItems.map((item) => [
        hu_id,
        item.items_batch_code,
        item.items_production_code,
        item.items_pd,
        item.items_cu,
        item.items_weight,
        0,
      ]);
      const placeholders = values.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");
      await conn.query(
        `INSERT INTO items_entry
         (items_hu_id, items_batch_code, items_production_code, items_pd, items_cu, items_weight, items_status)
         VALUES ${placeholders}`,
        values.flat(),
      );
    }
    await conn.commit();
    const [syncedItems] = await conn.query(
      `SELECT * FROM items_entry
       WHERE items_hu_id = ? AND items_status = 0
       ORDER BY items_id ASC`,
      [hu_id],
    );
    return res.json({
      success: true,
      message: "Items synced successfully",
      items: syncedItems,
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Sync failed",
      error: err.message,
    });
  } finally {
    conn.release();
  }
};

/* Paginated data */
export const getPaginatedItemEntries = async (req, res) => {
  let { page = 1, limit = 10 } = req.query;

  page = Number(page);
  limit = Number(limit);

  const offset = (page - 1) * limit;

  // Count ONLY active items
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total 
     FROM items_entry
     WHERE items_status = 0`,
  );

  // Fetch ONLY active items
  const [rows] = await db.query(
    `SELECT * FROM items_entry
     WHERE items_status = 0
     ORDER BY items_id DESC
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
export const getItemEntries = async (req, res) => {
  const [rows] = await db.query(
    "SELECT * FROM items_entry WHERE items_status = 0 ORDER BY items_id DESC",
  );

  res.json({
    success: true,
    count: rows.length,
    data: rows,
  });
};

export const getItemsEntryById = async (req, res) => {
  const { itemsId } = req.params;
  const status = 0;

  try {
    const [rows] = await db.query(
      "SELECT * FROM items_entry WHERE items_hu_id = ? AND items_status = ?",
      [itemsId, status],
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "No Item found for this transaction",
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
