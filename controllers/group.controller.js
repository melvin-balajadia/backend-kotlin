import db from "../config/db.js";
import AppError from "../utils/appError.js";
import { invalidateGroup } from "../middleware/checkPermission.js";

const isNonEmpty = (v) => typeof v === "string" && v.trim().length > 0;

// ══════════════════════════════════════════════════════════════════════════════
// GROUPS
// ══════════════════════════════════════════════════════════════════════════════

// ─── GET /groups ──────────────────────────────────────────────────────────────
export const getGroups = async (req, res, next) => {
  try {
    const [rows] = await db.query(
      "SELECT g.group_id, g.group_name, g.group_description, g.group_is_active, g.created_at, " +
        "COUNT(DISTINCT u.user_id) AS user_count, COUNT(DISTINCT gp.permission_id) AS permission_count " +
        "FROM `groups` g " +
        "LEFT JOIN user_records u ON u.user_groupid = g.group_id AND u.user_status = 'active' " +
        "LEFT JOIN group_permissions gp ON gp.group_id = g.group_id " +
        "GROUP BY g.group_id " +
        "ORDER BY g.group_id ASC",
    );

    return res.status(200).json({ errorStatus: false, data: rows });
  } catch (err) {
    next(err);
  }
};

// ─── GET /groups/:id ──────────────────────────────────────────────────────────
export const getGroupById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[group]] = await db.query(
      "SELECT group_id, group_name, group_description, group_is_active, created_at " +
        "FROM `groups` WHERE group_id = ? LIMIT 1",
      [id],
    );

    if (!group) return next(new AppError("Group not found.", 404));

    const [permissions] = await db.query(
      "SELECT p.permission_id, p.permission_key, p.permission_label, p.permission_group " +
        "FROM group_permissions gp " +
        "JOIN permissions p ON p.permission_id = gp.permission_id " +
        "WHERE gp.group_id = ? " +
        "ORDER BY p.permission_group, p.permission_key",
      [id],
    );

    return res.status(200).json({
      errorStatus: false,
      data: { ...group, permissions },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /groups ─────────────────────────────────────────────────────────────
export const createGroup = async (req, res, next) => {
  try {
    const { group_name, group_description } = req.body;

    if (!isNonEmpty(group_name)) {
      return next(new AppError("Group name is required.", 400));
    }

    const [[existing]] = await db.query(
      "SELECT group_id FROM `groups` WHERE group_name = ? LIMIT 1",
      [group_name.trim()],
    );
    if (existing) return next(new AppError("Group name already exists.", 409));

    const [result] = await db.query(
      "INSERT INTO `groups` (group_name, group_description) VALUES (?, ?)",
      [group_name.trim(), group_description?.trim() ?? null],
    );

    return res.status(201).json({
      errorStatus: false,
      message: "Group created successfully.",
      data: { group_id: result.insertId },
    });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /groups/:id ────────────────────────────────────────────────────────
export const updateGroup = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { group_name, group_description, group_is_active } = req.body;

    const fields = [];
    const values = [];

    if (isNonEmpty(group_name)) {
      fields.push("group_name = ?");
      values.push(group_name.trim());
    }
    if (group_description !== undefined) {
      fields.push("group_description = ?");
      values.push(group_description ?? null);
    }
    if (group_is_active !== undefined) {
      // Guard: prevent deactivation while active users are still assigned
      if (!group_is_active) {
        const [[{ activeUserCount }]] = await db.query(
          "SELECT COUNT(*) AS activeUserCount FROM user_records WHERE user_groupid = ? AND user_status = 'active'",
          [id],
        );
        if (activeUserCount > 0) {
          return next(
            new AppError(
              `Cannot deactivate — ${activeUserCount} active user(s) are still assigned. Reassign them first.`,
              409,
            ),
          );
        }
      }
      fields.push("group_is_active = ?");
      values.push(group_is_active ? 1 : 0);
    }

    if (fields.length === 0) {
      return next(new AppError("No valid fields to update.", 400));
    }

    values.push(id);
    const [result] = await db.query(
      "UPDATE `groups` SET " + fields.join(", ") + " WHERE group_id = ?",
      values,
    );

    if (result.affectedRows === 0)
      return next(new AppError("Group not found.", 404));

    invalidateGroup(parseInt(id, 10));

    return res
      .status(200)
      .json({ errorStatus: false, message: "Group updated successfully." });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /groups/:id ───────────────────────────────────────────────────────
export const deleteGroup = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[{ count }]] = await db.query(
      "SELECT COUNT(*) AS count FROM user_records WHERE user_groupid = ? AND user_status = 'active' LIMIT 1",
      [id],
    );

    if (count > 0) {
      return next(
        new AppError(
          `Cannot delete group — ${count} active user(s) are still assigned. Reassign them first.`,
          409,
        ),
      );
    }

    const [result] = await db.query("DELETE FROM `groups` WHERE group_id = ?", [
      id,
    ]);
    if (result.affectedRows === 0)
      return next(new AppError("Group not found.", 404));

    invalidateGroup(parseInt(id, 10));

    return res
      .status(200)
      .json({ errorStatus: false, message: "Group deleted successfully." });
  } catch (err) {
    next(err);
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// PERMISSIONS
// ══════════════════════════════════════════════════════════════════════════════

// ─── GET /permissions ─────────────────────────────────────────────────────────
export const getPermissions = async (req, res, next) => {
  try {
    const [rows] = await db.query(
      "SELECT permission_id, permission_key, permission_label, permission_group " +
        "FROM permissions " +
        "ORDER BY permission_group, permission_key",
    );

    const grouped = rows.reduce((acc, p) => {
      const key = p.permission_group ?? "General";
      if (!acc[key]) acc[key] = [];
      acc[key].push(p);
      return acc;
    }, {});

    return res.status(200).json({ errorStatus: false, data: rows, grouped });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /groups/:id/permissions ──────────────────────────────────────────────
export const setGroupPermissions = async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    const { id } = req.params;
    const { permission_ids } = req.body;

    if (!Array.isArray(permission_ids)) {
      return next(new AppError("permission_ids must be an array.", 400));
    }

    const [[group]] = await conn.query(
      "SELECT group_id FROM `groups` WHERE group_id = ? LIMIT 1",
      [id],
    );
    if (!group) return next(new AppError("Group not found.", 404));

    await conn.beginTransaction();

    await conn.query("DELETE FROM group_permissions WHERE group_id = ?", [id]);

    if (permission_ids.length > 0) {
      const placeholders = permission_ids.map(() => "(?, ?)").join(", ");
      const values = permission_ids.flatMap((pid) => [id, pid]);
      await conn.query(
        "INSERT INTO group_permissions (group_id, permission_id) VALUES " +
          placeholders,
        values,
      );
    }

    await conn.commit();
    invalidateGroup(parseInt(id, 10));

    return res.status(200).json({
      errorStatus: false,
      message: `Permissions updated for group ${id}.`,
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
};

// ─── PATCH /groups/:id/permissions ────────────────────────────────────────────
export const patchGroupPermissions = async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    const { id } = req.params;
    const { add = [], remove = [] } = req.body;

    if (!Array.isArray(add) || !Array.isArray(remove)) {
      return next(new AppError("'add' and 'remove' must be arrays.", 400));
    }

    if (add.length === 0 && remove.length === 0) {
      return next(
        new AppError("Provide at least one permission to add or remove.", 400),
      );
    }

    const [[group]] = await conn.query(
      "SELECT group_id FROM `groups` WHERE group_id = ? LIMIT 1",
      [id],
    );
    if (!group) return next(new AppError("Group not found.", 404));

    await conn.beginTransaction();

    if (add.length > 0) {
      const placeholders = add.map(() => "(?, ?)").join(", ");
      const values = add.flatMap((pid) => [id, pid]);
      await conn.query(
        "INSERT IGNORE INTO group_permissions (group_id, permission_id) VALUES " +
          placeholders,
        values,
      );
    }

    if (remove.length > 0) {
      const placeholders = remove.map(() => "?").join(", ");
      await conn.query(
        "DELETE FROM group_permissions WHERE group_id = ? AND permission_id IN (" +
          placeholders +
          ")",
        [id, ...remove],
      );
    }

    await conn.commit();
    invalidateGroup(parseInt(id, 10));

    return res.status(200).json({
      errorStatus: false,
      message: "Group permissions patched successfully.",
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
};

// ─── ADD THIS to group.controller.js ─────────────────────────────────────────
// GET /paginated-groups
export const getPaginatedGroups = async (req, res, next) => {
  try {
    let {
      page = 1,
      per_page = 12,
      search = "",
      sort_by = "group_id",
      sort_dir = "asc",
      group_is_active,
    } = req.query;

    page = Number(page);
    per_page = Number(per_page);
    const offset = (page - 1) * per_page;

    // ── Whitelist sort columns ────────────────────────────────────────────────
    const allowedSorts = [
      "group_id",
      "group_name",
      "user_count",
      "permission_count",
      "created_at",
    ];
    if (!allowedSorts.includes(sort_by)) sort_by = "group_id";
    if (!["asc", "desc"].includes(sort_dir.toLowerCase())) sort_dir = "asc";

    // ── Build WHERE ───────────────────────────────────────────────────────────
    const conditions = [];
    const values = [];

    if (search) {
      conditions.push("(g.group_name LIKE ? OR g.group_description LIKE ?)");
      values.push(`%${search}%`, `%${search}%`);
    }

    if (group_is_active !== undefined && group_is_active !== "") {
      conditions.push("g.group_is_active = ?");
      values.push(Number(group_is_active));
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // ── Count ─────────────────────────────────────────────────────────────────
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM \`groups\` g
       ${where}`,
      values,
    );

    // ── Fetch with aggregates ─────────────────────────────────────────────────
    const [rows] = await db.query(
      `SELECT
         g.group_id,
         g.group_name,
         g.group_description,
         g.group_is_active,
         g.created_at,
         COUNT(DISTINCT u.user_id)  AS user_count,
         COUNT(DISTINCT gp.permission_id) AS permission_count
       FROM \`groups\` g
       LEFT JOIN user_records u
         ON u.user_groupid = g.group_id AND u.user_status = 'active'
       LEFT JOIN group_permissions gp
         ON gp.group_id = g.group_id
       ${where}
       GROUP BY g.group_id
       ORDER BY ${sort_by} ${sort_dir}
       LIMIT ? OFFSET ?`,
      [...values, per_page, offset],
    );

    return res.status(200).json({
      errorStatus: false,
      data: rows,
      meta: {
        current_page: page,
        per_page,
        total,
        last_page: Math.ceil(total / per_page),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /groups/:id/users ────────────────────────────────────────────────────
/**
 * Returns all active users assigned to a group.
 * Used by the reassignment modal to show who needs to be moved.
 */
export const getGroupUsers = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      "SELECT user_id, user_username, user_firstname, user_lastname, user_status " +
        "FROM user_records " +
        "WHERE user_groupid = ? AND user_status = 'active' " +
        "ORDER BY user_lastname ASC, user_firstname ASC",
      [id],
    );

    return res.status(200).json({ errorStatus: false, data: rows });
  } catch (err) {
    next(err);
  }
};

// ─── POST /groups/:id/reassign ────────────────────────────────────────────────
/**
 * Bulk reassigns specific users from this group to a new group.
 * Body: { assignments: [{ user_id: 1, new_group_id: 3 }, ...] }
 *
 * Each user can be reassigned to a different group individually,
 * so the frontend inline-dropdown-per-user pattern is fully supported.
 */
export const reassignGroupUsers = async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    const { id } = req.params;
    const { assignments } = req.body;

    // ── Validation ──────────────────────────────────────────────────────────────
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return next(new AppError("assignments must be a non-empty array.", 400));
    }

    for (const a of assignments) {
      if (!a.user_id || !a.new_group_id) {
        return next(
          new AppError(
            "Each assignment must have user_id and new_group_id.",
            400,
          ),
        );
      }
      if (parseInt(a.new_group_id, 10) === parseInt(id, 10)) {
        return next(
          new AppError(
            `User ${a.user_id} cannot be reassigned to the same group.`,
            400,
          ),
        );
      }
    }

    // ── Validate all target groups exist and are active ─────────────────────────
    const targetGroupIds = [...new Set(assignments.map((a) => a.new_group_id))];
    const [validGroups] = await conn.query(
      "SELECT group_id FROM `groups` WHERE group_id IN (" +
        targetGroupIds.map(() => "?").join(",") +
        ") AND group_is_active = 1",
      targetGroupIds,
    );
    const validIds = new Set(validGroups.map((g) => g.group_id));
    const invalid = targetGroupIds.find(
      (gid) => !validIds.has(parseInt(gid, 10)),
    );
    if (invalid) {
      return next(
        new AppError(
          `Target group ${invalid} does not exist or is inactive.`,
          400,
        ),
      );
    }

    // ── Apply reassignments in a transaction ────────────────────────────────────
    await conn.beginTransaction();

    for (const { user_id, new_group_id } of assignments) {
      await conn.query(
        "UPDATE user_records SET user_groupid = ? WHERE user_id = ? AND user_groupid = ?",
        [new_group_id, user_id, id],
      );
    }

    await conn.commit();

    // Invalidate permission cache for the source group
    invalidateGroup(parseInt(id, 10));

    return res.status(200).json({
      errorStatus: false,
      message: `${assignments.length} user(s) reassigned successfully.`,
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
};
