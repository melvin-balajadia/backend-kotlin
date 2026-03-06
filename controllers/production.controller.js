import db from "../config/db.js";

/* Create production data */
export const createProduction = async (req, res) => {
  const { productionCode, netWeight, value, unit, consumeUntil } = req.body;

  if (!productionCode || !netWeight || !value || !unit || !consumeUntil) {
    return res.status(400).json({
      success: false,
      message: "All fields are required",
    });
  }

  const sql = `
    INSERT INTO production_data
    (productionCode, netWeight, value, unit, consumeUntil)
    VALUES (?, ?, ?, ?, ?)
  `;

  const [result] = await db.query(sql, [
    productionCode,
    netWeight,
    value,
    unit,
    consumeUntil,
  ]);

  res.status(201).json({
    success: true,
    message: "Data saved successfully",
    data: {
      id: result.insertId,
      productionCode,
      netWeight,
      value,
      unit,
      consumeUntil,
    },
  });
};

/* Get all data */
export const getProductions = async (req, res) => {
  const [rows] = await db.query(
    "SELECT * FROM production_data ORDER BY id DESC",
  );

  res.json({
    success: true,
    count: rows.length,
    data: rows,
  });
};

/* Paginated data */
export const getPaginatedProductions = async (req, res) => {
  let { page = 1, limit = 10 } = req.query;

  page = Number(page);
  limit = Number(limit);

  const offset = (page - 1) * limit;

  const [[{ total }]] = await db.query(
    "SELECT COUNT(*) AS total FROM production_data",
  );

  const [rows] = await db.query(
    `SELECT * FROM production_data
     ORDER BY id DESC
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
export const getProductionById = async (req, res) => {
  const { id } = req.params;

  const [rows] = await db.query("SELECT * FROM production_data WHERE id = ?", [
    id,
  ]);

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
