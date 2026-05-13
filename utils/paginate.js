export const paginate = async ({
  query,
  table, // now accepts "table t LEFT JOIN other o ON ..."
  searchColumns = [],
  allowedSorts = [],
  defaultSort,
  filters,
  baseCondition,
  selectClause = "*", // ← new, defaults to * so existing callers are unaffected
  db,
}) => {
  let {
    page = 1,
    per_page = 10,
    search = "",
    sort_by,
    sort_dir = "desc",
  } = query;

  page = Number(page);
  per_page = Number(per_page);
  const offset = (page - 1) * per_page;

  if (!allowedSorts.includes(sort_by)) sort_by = defaultSort ?? allowedSorts[0];
  if (!["asc", "desc"].includes(sort_dir.toLowerCase())) sort_dir = "desc";

  const conditions = [];
  const values = [];

  if (baseCondition) conditions.push(baseCondition);

  if (search && searchColumns.length) {
    const likeClause = searchColumns.map((col) => `${col} LIKE ?`).join(" OR ");
    conditions.push(`(${likeClause})`);
    const like = `%${search}%`;
    searchColumns.forEach(() => values.push(like));
  }

  if (typeof filters === "function") {
    filters(query, conditions, values);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  // Count uses a subquery so JOINs with GROUP BY still count correctly
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM ${table} ${where}`,
    values,
  );

  const [data] = await db.query(
    `SELECT ${selectClause} FROM ${table}
     ${where}
     ORDER BY ${sort_by} ${sort_dir}
     LIMIT ? OFFSET ?`,
    [...values, per_page, offset],
  );

  return {
    data,
    meta: {
      current_page: page,
      per_page,
      total,
      last_page: Math.ceil(total / per_page),
    },
  };
};
