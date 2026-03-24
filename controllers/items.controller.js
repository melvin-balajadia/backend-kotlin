import db from "../config/db.js";

export const bulkUpsertItems = async (req, res) => {
  const { hu_id, items } = req.body;

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
      items_id: item.items_id ?? null,
      items_batch_code: item.items_batch_code ?? null,
      items_pd: item.items_pd ?? null,
      items_cu: item.items_cu ?? null,
      items_weight: item.items_weight ?? null,
    }));

    // 2. Split items
    const existingItems = cleanItems.filter((i) => i.items_id);
    const newItems = cleanItems.filter((i) => !i.items_id);

    const existingIds = existingItems.map((i) => i.items_id);

    // 3. Deactivate removed items
    if (existingIds.length > 0) {
      const placeholders = existingIds.map(() => "?").join(", ");

      await conn.query(
        `UPDATE items_entry
         SET items_status = 1
         WHERE items_hu_id = ?
         AND items_id NOT IN (${placeholders})`,
        [hu_id, ...existingIds],
      );
    } else {
      // If frontend sends empty → delete all
      await conn.query(
        `UPDATE items_entry
         SET items_status = 1
         WHERE items_hu_id = ?`,
        [hu_id],
      );
    }

    // 4. Update existing items
    if (existingItems.length > 0) {
      const values = existingItems.map((item) => [
        item.items_id,
        hu_id,
        item.items_batch_code,
        item.items_pd,
        item.items_cu,
        item.items_weight,
        0,
      ]);

      const placeholders = values.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");

      await conn.query(
        `
        INSERT INTO items_entry
        (items_id, items_hu_id, items_batch_code, items_pd, items_cu, items_weight, items_status)
        VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE
          items_batch_code = VALUES(items_batch_code),
          items_pd = VALUES(items_pd),
          items_cu = VALUES(items_cu),
          items_weight = VALUES(items_weight),
          items_status = 0,
          updated_at = CURRENT_TIMESTAMP
        `,
        values.flat(),
      );
    }

    // 5. Insert new items
    if (newItems.length > 0) {
      const values = newItems.map((item) => [
        hu_id,
        item.items_batch_code,
        item.items_pd,
        item.items_cu,
        item.items_weight,
        0,
      ]);

      const placeholders = values.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");

      await conn.query(
        `
        INSERT INTO items_entry
        (items_hu_id, items_batch_code, items_pd, items_cu, items_weight, items_status)
        VALUES ${placeholders}
        `,
        values.flat(),
      );
    }

    await conn.commit();

    return res.json({
      success: true,
      message: "Items synced successfully",
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
